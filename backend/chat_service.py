from rag_service import rag_service, ensure_preloaded
from tools import available_tools
from groq import Groq
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure Groq
client = Groq(api_key=os.getenv('GROQ_API_KEY'))

class ChatService:
    def __init__(self):
        self.history = {} # Session-based history
        self.model = "llama-3.1-8b-instant" # High-speed default model

    async def generate_response(self, user_input: str, session_id: str = "default", image_data: dict = None):
        try:
            # 1. RAG: Retrieve context
            context = await rag_service.retrieve_context(user_input)
            
            # 2. Agent/Tools: Check if tools are needed
            tool_result = ""
            try:
                if "weather" in user_input.lower():
                    city = "London"
                    if "in" in user_input:
                        city = user_input.split("in")[-1].strip()
                    tool_result = available_tools[0].invoke(city)
                elif "search" in user_input.lower():
                    query = user_input.replace("search", "").strip()
                    tool_result = available_tools[1].invoke(query)
            except Exception as e:
                print(f"Tool execution error: {e}")
                tool_result = f"Error executing tool: {str(e)}"

            # 3. Build system prompt and message list
            system_prompt = "You are CaptBot, a professional AI executive assistant. Provide helpful, concise responses."
            
            if context:
                system_prompt += f"\n\nRelevant context from knowledge base:\n{context}"
                
            messages = [
                {"role": "system", "content": system_prompt},
            ]

            # Add tool result to the conversation if available
            user_content = user_input
            if tool_result:
                user_content += f"\n\n(Tool Tool Result: {tool_result})"
            
            if image_data:
                user_content += f"\n\n(Note: User uploaded an image named {image_data['filename']}. Groq Llama 3 is text-only, so please acknowledge the file but explain you cannot see it yet.)"

            messages.append({"role": "user", "content": user_content})

            # 4. Generate response with Groq
            completion = client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=0.7,
                max_tokens=1024,
                top_p=1,
                stream=False,
                stop=None,
            )
            
            return completion.choices[0].message.content
            
        except Exception as e:
            import traceback
            traceback.print_exc()
            return f"Error generating response: {str(e)}"

chat_service = ChatService()
