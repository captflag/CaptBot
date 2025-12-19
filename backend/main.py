from fastapi import FastAPI, APIRouter, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
import os
from dotenv import load_dotenv
from typing import Optional
import traceback

load_dotenv()

app = FastAPI(title="AI Chatbot API", version="0.1.0")

# Configure CORS
origins_raw = os.getenv("ALLOWED_ORIGINS", "*")
if origins_raw == "*":
    origins = ["*"]
else:
    origins = [o.strip() for o in origins_raw.split(",") if o.strip()]

dev_origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
if "*" not in origins:
    for origin in dev_origins:
        if origin not in origins:
            origins.append(origin)

is_wildcard = "*" in origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if is_wildcard else origins,
    allow_credentials=not is_wildcard,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# API Router with /api prefix
api_router = APIRouter(prefix="/api")

@api_router.get("/")
async def root():
    return {"message": "AI Chatbot API is running"}

@api_router.get("/health")
async def health_check():
    return {"status": "healthy"}

@api_router.post("/chat")
async def chat_endpoint(
    message: str = Form(...),
    session_id: str = Form("default"),
    file: Optional[UploadFile] = File(None)
):
    try:
        print(f"Received message: {message}")
        from chat_service import chat_service
        
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

# Include the router in the main app
app.include_router(api_router)

# Also keep the root health/root for legacy or direct access
@app.get("/")
async def legacy_root():
    return await root()

@app.get("/health")
async def legacy_health():
    return await health_check()
