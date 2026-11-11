from dotenv import load_dotenv
import os

load_dotenv()

# Read from environment
api_key = os.environ.get('API_KEY')
database = os.environ.get('DATABASE_NAME', 'default.db')

print(f"Using database: {database}")
print (f"Using API_Key: {api_key}")
