import os
from groq import Groq
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def test_groq():
    api_key = os.getenv('GROQ_API_KEY')
    if not api_key:
        print("ERROR: GROQ_API_KEY not found in environment variables.")
        return

    try:
        client = Groq(api_key=api_key)
        
        chat_completion = client.chat.completions.create(
            messages=[
                {
                    "role": "user",
                    "content": "Say 'Groq is active!'",
                }
            ],
            model="llama-3.1-8b-instant",
        )
        
        print("\n--- Groq API Test ---")
        print(f"Response: {chat_completion.choices[0].message.content}")
        print("Status: SUCCESS")
        
    except Exception as e:
        print(f"\n--- Groq API Test ---")
        print(f"Status: FAILED")
        print(f"Error: {str(e)}")

if __name__ == "__main__":
    test_groq()
