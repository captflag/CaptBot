import os
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

client = Groq(api_key=os.getenv('GROQ_API_KEY'))

try:
    models = client.models.list()
    print("\n--- AVAILABLE GROQ MODELS ---")
    for model in models.data:
        print(f"ID: {model.id}")
    print("--- END OF LIST ---\n")
except Exception as e:
    print(f"Error listing Groq models: {e}")
