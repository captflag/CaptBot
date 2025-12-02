import requests

url = "http://localhost:8000/chat"
data = {
    "message": "Hello",
    "session_id": "test"
}

try:
    response = requests.post(url, data=data)
    print(f"Status Code: {response.status_code}")
    print(f"Response: {response.text}")
except Exception as e:
    print(f"Error: {e}")
