# CaptBot 📟

CaptBot is a high-performance AI executive assistant featuring a **Vintage CRT Terminal** aesthetic. It's built with **Next.js 16** and **FastAPI**, powered by the ultra-fast **Groq Llama 3** AI engine.

![CRT Terminal Interface](file:///C:/Users/divya/.gemini/antigravity/brain/57ce9a34-6a05-4005-b856-d9409a12401f/crt_theme_active_check_1766073648115.png)

## ✨ Features

- **🎨 Vintage CRT UI**: High-fidelity retro terminal aesthetic with scanlines, flickering, and glowing green monochrome text.
- **⚡ Ultra-Fast AI**: Leverages the Groq API (Llama 3-8B) for near-instantaneous response times.
- **📁 Multimodal Support**: Acknowledgement for file uploads and image metadata processing.
- **🔍 RAG Integration**: Context-aware responses using Retrieval-Augmented Generation via ChromaDB.
- **🛠️ Extensible Tools**: Real-time web search and weather capabilities.
- **🌐 Production Ready**: Optimized for Vercel deployment with dedicated serverless backend configuration.

## 🏗️ Architecture

### Frontend
- **Framework**: Next.js 16 (Turbopack)
- **Styling**: Vanilla CSS with CRT shader effects
- **Typography**: Strictly monospaced (`JetBrains Mono`)

### Backend
- **Framework**: FastAPI (Python)
- **AI Model**: Groq Llama 3-8B
- **RAG/Vector DB**: LangChain + ChromaDB
- **Hosting**: Vercel Serverless Functions compatibility

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ and npm
- Python 3.10+
- Groq API Key ([Get one here](https://console.groq.com/))

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/captflag/CaptBot.git
   cd CaptBot
   ```

2. **Backend Configuration**
   ```bash
   cd backend
   pip install -r requirements.txt
   ```
   Create a `.env` file:
   ```env
   GROQ_API_KEY=your_groq_api_key_here
   ALLOWED_ORIGINS=http://localhost:3000
   ```

3. **Frontend Configuration**
   ```bash
   cd ../frontend
   npm install
   ```
   Create a `.env.local` file:
   ```env
   NEXT_PUBLIC_API_URL=http://localhost:8000
   ```

### Running Locally

1. **Start the Backend**: `uvicorn main:app --reload`
2. **Start the Frontend**: `npm run dev`

## 📦 Deployment to Vercel

### Backend (FastAPI)
- Root Directory: `backend`
- Framework Preset: `Other`
- Required Env Vars: `GROQ_API_KEY`, `ALLOWED_ORIGINS`

### Frontend (Next.js)
- Root Directory: `frontend`
- Framework Preset: `Next.js`
- Required Env Vars: `NEXT_PUBLIC_API_URL` (Your deployed Backend URL)

---

**Made with ❤️ by [captflag](https://github.com/captflag)**
