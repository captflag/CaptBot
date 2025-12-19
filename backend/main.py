from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="AI Chatbot API", version="0.1.0")

import os
from dotenv import load_dotenv

load_dotenv()

# Configure CORS
origins_raw = os.getenv("ALLOWED_ORIGINS", "*")
if origins_raw == "*":
    # In development, it's often safer to explicitly allow common origins 
    # if wildcard causes issues with credentials/headers
    origins = ["*"]
else:
    origins = [o.strip() for o in origins_raw.split(",") if o.strip()]

# Add common development origins if not present
dev_origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
if "*" not in origins:
    for origin in dev_origins:
        if origin not in origins:
            origins.append(origin)

is_wildcard = "*" in origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=not is_wildcard,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


@app.get("/")
async def root():
    return {"message": "AI Chatbot API is running"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

from pydantic import BaseModel

from fastapi import File, UploadFile, Form
from typing import Optional
import traceback

@app.post("/chat")
async def chat_endpoint(
    message: str = Form(...),
    session_id: str = Form("default"),
    file: Optional[UploadFile] = File(None)
):
    try:
        print(f"Received message: {message}")
        
        # Import here to avoid circular imports if any, or just for now
        from chat_service import chat_service
        
        # Process file if present (mock logic for now)
        image_data = None
        if file:
            content = await file.read()
            image_data = {"filename": file.filename, "size": len(content)}
        
        response = await chat_service.generate_response(message, session_id, image_data)
        return {"response": response}
    except Exception as e:
        print(f"ERROR in chat_endpoint: {e}")
        traceback.print_exc()
        return {"response": f"Error: {str(e)}"}
