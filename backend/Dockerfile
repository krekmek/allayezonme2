FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create a simple healthcheck script
RUN echo 'import sys\nfrom db import supabase\ntry:\n    supabase.table("staff").select("*").limit(1).execute()\n    print("OK")\n    sys.exit(0)\nexcept:\n    print("FAIL")\n    sys.exit(1)' > /app/healthcheck.py

# Run healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD python /app/healthcheck.py

# Run the bot with restart capability
CMD ["python", "bot.py"]
