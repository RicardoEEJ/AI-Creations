# This is only for me to keep track of what was done,

#I can see nothing has been done using python

import os

# Read from environment
api_key = os.environ.get('API_KEY')
database = os.environ.get('DATABASE_NAME', 'default.db')

print(f"Using database: {database}")

