import requests
import json
import random
import time

RASPI_ID = 1231231283812387
SERVER_URL = "http://localhost:3000/api/iot-data"

def generate_mock_data():
    return {
        "raspi_serial_id": RASPI_ID,
        "data": [
            {
                "sensor_controller_id": 1,
                "ultrasonic-1": random.randint(10, 50),
                "ultrasonic-2": random.randint(10, 50),
                "temperature": random.randint(20, 30),
                "ultrasonic-3": random.randint(10, 50),
                "ultrasonic-4": random.randint(10, 50),
            },
            {
                "sensor_controller_id": 2,
                "humidity-1": random.randint(30, 70),
                "humidity-2": random.randint(30, 70),
                "temperature": random.randint(20, 30)
            }
        ]
    }

while True:
    data = generate_mock_data()
    try:
        response = requests.post(SERVER_URL, json=data)
        print(f"Status: {response.status_code} - Data sent at {time.ctime()}")
    except Exception as e:
        print(f"Error: {e}")
    time.sleep(5)  # kirim data setiap 5 detik
