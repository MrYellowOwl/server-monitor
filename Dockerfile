FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    procps iproute2 ufw fail2ban \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV SM_PASSWORD=changeme \
    SM_PORT=6969

EXPOSE 6969

CMD ["gunicorn", "-w", "2", "-b", "0.0.0.0:6969", "--timeout", "60", "app:app"]
