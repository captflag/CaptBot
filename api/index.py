# Vercel Python serverless function - self-contained FastAPI app
from fastapi import FastAPI, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional
import os
import traceback

app = FastAPI(title="AI Chatbot API", version="0.1.0")

# Configure CORS - allow all origins for serverless
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

@app.get("/")
async def root():
    return {"message": "AI Chatbot API is running on Vercel"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.post("/chat")
async def chat_endpoint(
    message: str = Form(...),
    session_id: str = Form("default"),
    file: Optional[UploadFile] = File(None)
):
    try:
        # Inline Groq chat logic
        from groq import Groq
        
        groq_api_key = os.getenv('GROQ_API_KEY')
        if not groq_api_key:
            return {"response": "Error: GROQ_API_KEY environment variable not set."}
        
        client = Groq(api_key=groq_api_key)
        
        system_prompt = "You are CaptBot, a professional AI executive assistant. Provide helpful, concise responses. You are master of all knowledge."
        
        user_content = message
        if file:
            user_content += f"\n\n(Note: User uploaded an image named {file.filename}. Groq Llama 3 is text-only, so please acknowledge the file but explain you cannot see it yet.)"
        
        completion = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content}
            ],
            temperature=0.5,
            max_tokens=1024,
            top_p=1,
            stream=False,
            stop=None,
        )
        
        return {"response": completion.choices[0].message.content}
    except Exception as e:
        print(f"ERROR in chat_endpoint: {e}")
        traceback.print_exc()
        return {"response": f"Error: {str(e)}"}
