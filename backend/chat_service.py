from rag_service import rag_service, ensure_preloaded
from tools import available_tools
import google.generativeai as genai
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure Gemini
genai.configure(api_key=os.getenv('GOOGLE_API_KEY'))

class ChatService:
    def __init__(self):
        self.history = {} # Session-based history
        self.model = genai.GenerativeModel('gemini-2.5-flash-lite')

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

            # 3. Build enhanced prompt with context and tool results
            prompt_parts = [f"User question: {user_input}"]
            
            if context:
                prompt_parts.append(f"\nRelevant context from knowledge base:\n{context}")
                
            if tool_result:
                prompt_parts.append(f"\nTool execution result:\n{tool_result}")
                
            if image_data:
                prompt_parts.append(f"\nUser uploaded an image: {image_data['filename']}")
            
            prompt_parts.append("\nPlease provide a helpful, concise response based on the above information.")
            
            full_prompt = "\n".join(prompt_parts)
            
            # 4. Generate response with Gemini
            response = self.model.generate_content(full_prompt)
            
            return response.text
            
        except Exception as e:
            import traceback
            traceback.print_exc()
            return f"Error generating response: {str(e)}"

chat_service = ChatService()
