# Simplified RAG service with native Python (no LangChain)

class RAGService:
    def __init__(self):
        self.documents = []

    def split_text(self, text, chunk_size=1000, overlap=200):
        chunks = []
        start = 0
        while start < len(text):
            end = start + chunk_size
            chunks.append(text[start:end])
            start += chunk_size - overlap
        return chunks

    async def ingest_text(self, text: str, source: str = "manual"):
        splits = self.split_text(text)
        for chunk in splits:
            self.documents.append({"content": chunk, "source": source})
        return len(splits)

    async def retrieve_context(self, query: str):
        # Simple keyword matching instead of vector search
        await ensure_preloaded()
        matching_docs = [doc["content"] for doc in self.documents if any(word.lower() in doc["content"].lower() for word in query.split())]
        if matching_docs:
            return "\n\n".join(matching_docs[:3])
        return ""

rag_service = RAGService()

# Pre-load some data on first request instead of at module level
_preloaded = False

async def ensure_preloaded():
    global _preloaded
    if not _preloaded:
        await rag_service.ingest_text(
            "The AI Chatbot is built with Next.js and FastAPI. It supports text and image inputs.",
            source="system_docs"
        )
        _preloaded = True
