# Simplified RAG service with in-memory storage (chromadb has import issues)
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document

class RAGService:
    def __init__(self):
        self.documents = []
        self.text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)

    async def ingest_text(self, text: str, source: str = "manual"):
        docs = [Document(page_content=text, metadata={"source": source})]
        splits = self.text_splitter.split_documents(docs)
        self.documents.extend(splits)
        return len(splits)

    async def retrieve_context(self, query: str):
        # Simple keyword matching instead of vector search
        await ensure_preloaded()
        matching_docs = [doc for doc in self.documents if any(word.lower() in doc.page_content.lower() for word in query.split())]
        if matching_docs:
            return "\n\n".join([d.page_content for d in matching_docs[:3]])
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
