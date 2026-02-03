
import { GoogleGenAI, Modality as GenModality, GenerateContentResponse } from "@google/genai";
import { SYSTEM_INSTRUCTION } from "../constants";
import { ModelID, FileData } from "../types";
import { rag } from "./ragService";

export class GeminiService {
  private getAI() {
    return new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  }

  async *sendMessageStream(
    message: string, 
    history: { role: 'user' | 'model'; parts: { text?: string; inlineData?: any }[] }[] = [],
    modality: string = 'STRATEGIC',
    modelId: ModelID = 'gemini-3-flash-preview',
    thinkingBudget: number = 0,
    attachments: FileData[] = [],
    useWebSearch: boolean = false,
    signal?: AbortSignal
  ) {
    const ai = this.getAI();
    
    // Check abort before starting
    if (signal?.aborted) throw new Error("Aborted");

    // 1. PERFORM RAG RETRIEVAL (Non-blocking now)
    const contextChunks = await rag.search(message);
    const contextText = contextChunks.length > 0 
      ? `\n\n[INTERNAL_KNOWLEDGE_BASE]\n${contextChunks.map(c => `FROM SOURCE "${c.sourceName}": ${c.text}`).join('\n---\n')}\n[END_INTERNAL_KNOWLEDGE]`
      : "";

    const isVisualRequest = /image|visual|draw|picture|look like/i.test(message) && attachments.length === 0;

    if (isVisualRequest) {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: { parts: [{ text: `High-end consultant visualization for: ${message}. Professional, minimalist, elegant aesthetic.` }] },
      });

      let imageUrl = '';
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          imageUrl = `data:image/png;base64,${part.inlineData.data}`;
        }
      }
      
      yield { 
        text: `Executive Summary: Visual projection synthesized.\n\n### Strategic Visualization\nGenerated visual asset.\n\n[UI: IMAGE_PROJECTION]`, 
        imageUrl,
        isComplete: true
      };
      return;
    }

    // 2. AUGMENT PROMPT WITH RETRIEVED CONTEXT
    const parts: any[] = [{ text: `[MODE: ${modality}]${contextText}\n\nUSER_QUERY: ${message}` }];
    
    attachments.forEach(file => {
      parts.push({ inlineData: { mimeType: file.mimeType, data: file.data } });
    });

    // Configure tools dynamically
    const tools: any[] = [];
    if (useWebSearch) {
      tools.push({ googleSearch: {} });
    }

    const config: any = {
      systemInstruction: SYSTEM_INSTRUCTION + (contextChunks.length > 0 ? "\n\nCRITICAL: Use the [INTERNAL_KNOWLEDGE_BASE] data provided in the prompt to ground your answer. If the data is relevant, cite the source name." : ""),
      tools: tools.length > 0 ? tools : undefined,
      // ACCURACY UPGRADE: Lower temperature for factual tasks
      temperature: modality === 'STRATEGIC' || modality === 'TACTICAL' ? 0.2 : 0.7,
      thinkingConfig: thinkingBudget > 0 ? { thinkingBudget: thinkingBudget } : undefined
    };

    if (modality === 'TACTICAL') {
      config.tools = config.tools || [];
      config.tools.push({ googleMaps: {} });
      try {
        const pos = await new Promise<GeolocationPosition>((res, rej) => 
          navigator.geolocation.getCurrentPosition(res, rej, { timeout: 3000 })
        );
        config.toolConfig = {
          retrievalConfig: {
            latLng: { latitude: pos.coords.latitude, longitude: pos.coords.longitude }
          }
        };
      } catch (e) {
        console.warn("Location access denied or timed out for TACTICAL mode.");
      }
    }
    
    // Ensure config.tools is valid if empty (remove property)
    if (config.tools && config.tools.length === 0) {
        delete config.tools;
    }

    const stream = await ai.models.generateContentStream({
      model: modelId,
      contents: [...history, { role: 'user', parts: parts }],
      config
    });

    for await (const chunk of stream) {
      if (signal?.aborted) {
        throw new Error("Aborted by user");
      }
      const c = chunk as GenerateContentResponse;
      yield {
        text: c.text,
        candidates: c.candidates,
        isComplete: false,
        groundedChunks: contextChunks.map(c => c.sourceName)
      };
    }
  }

  // sendMessage simplified for brevity, logic mirrors stream
  async sendMessage(
    message: string, 
    history: any[] = [],
    modality: string = 'STRATEGIC',
    modelId: ModelID = 'gemini-3-flash-preview',
    thinkingBudget: number = 0,
    attachments: FileData[] = []
  ) {
    const ai = this.getAI();
    const config: any = {
      systemInstruction: SYSTEM_INSTRUCTION,
      tools: [{ googleSearch: {} }],
      temperature: 0.2, // Default to precise
      thinkingConfig: thinkingBudget > 0 ? { thinkingBudget: thinkingBudget } : undefined
    };

    const parts: any[] = [{ text: `[MODE: ${modality}] ${message}` }];
    attachments.forEach(file => {
      parts.push({ inlineData: { mimeType: file.mimeType, data: file.data } });
    });

    const response = await ai.models.generateContent({
      model: modelId,
      contents: [...history, { role: 'user', parts: parts }],
      config
    });

    return { text: response.text, candidates: response.candidates };
  }
}

export const gemini = new GeminiService();
