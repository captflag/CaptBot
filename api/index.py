# Vercel Python serverless function entry point
# This file re-exports the FastAPI app from the backend directory
import sys
import os

# Add the backend directory to the Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from main import app

# Vercel expects the app to be named 'app' or 'handler'
# FastAPI apps are ASGI apps, which Vercel's Python runtime supports
