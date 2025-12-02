from langchain.tools import tool

@tool
def get_weather(city: str):
    """Get the current weather for a specific city."""
    # Mock implementation
    return f"The weather in {city} is sunny and 25°C."

@tool
def search_web(query: str):
    """Search the web for information."""
    # Mock implementation
    return f"Results for: {query}"

available_tools = [get_weather, search_web]
