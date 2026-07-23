# CandyVoice Demo [CandyDemo Web app](https://candyvoice.web.app/)

## Overview

CandyVoice Demo is a full-stack demonstration platform exposing several AI-based speech processing services through a secure web application.

The platform consists of a static frontend hosted on Firebase Hosting, authenticated with Firebase Authentication, and a Python REST API responsible for orchestrating the CandyVoice inference engine. The backend manages asynchronous processing, quota enforcement, secure file delivery, progress reporting, and third-party integrations.

Current processing pipelines include:

- Noise Filtering (NoizeOff)
- Voice Imitation
- Deepfake Detection

---

## Technical Architecture

```
                    Browser
                       │
          Firebase Authentication
                       │
               ID Token (JWT)
                       │
        Firebase Hosting (Frontend)
                       │
             HTTPS REST Requests
                       │
             Python API (Flask)
                       │
      ┌────────┬──────────────┬─────────────┐
      │        │              │
 Noise Filter  Voice Clone   Deepfake Model
      │        │              │
      └────────┴──────────────┘
               Processing Engine
                       │
          Output File Generation
                       │
      Signed Download URL returned
```

## Core Features

- Firebase Authentication with ID token verification
- Firestore-backed user quota management
- REST API for AI inference services
- Server-side upload validation
- Live processing progress (SSE/streamed updates)
- Secure signed download links
- Rate limiting and request validation
- HubSpot integration for feedback collection
- SMTP2GO email verification workflow
- Firebase Cloud Functions for backend automation

## Repository Structure

```text
functions/              Firebase Cloud Functions
public/                 Static frontend assets
python-api/             Flask API
docs/                   Documentation
firebase.json           Hosting configuration
firestore.rules         Firestore security rules
```

## Backend

The Python service exposes independent processing endpoints for each inference pipeline.

| Endpoint | Description |
|----------|-------------|
| POST /api/noise-filter | Noise reduction pipeline |
| POST /api/imitation | Voice imitation pipeline |
| POST /api/deepfake-detection | AI-generated speech detection |
| GET /outputs/<file> | Secure output retrieval |
| GET /health | Health endpoint |

The backend is responsible for:

- Authentication verification
- Usage quota enforcement
- Temporary file management
- Progress streaming
- Process orchestration
- Output cleanup
- Error handling

## Frontend

The frontend is a vanilla JavaScript application deployed on Firebase Hosting.

Responsibilities include:

- Authentication flow
- File upload
- Progress visualization
- API communication
- Download management
- User profile and quota display
- HubSpot survey integration after successful processing

## Security

- Firebase JWT verification
- Firestore security rules
- CORS restrictions
- MIME type validation
- Allowed model validation
- Signed download URLs
- Request rate limiting
- Temporary file cleanup

## Technologies

### Frontend
- HTML5
- CSS3
- JavaScript (ES6)
- Firebase Hosting

### Backend
- Python
- Flask
- Firebase Admin SDK

### Services
- Firestore
- Firebase Authentication
- Cloud Functions
- HubSpot
- SMTP2GO

## Local Development

```bash
# Frontend
npm install
firebase emulators:start

# Backend
python -m venv venv
pip install -r requirements.txt
python api_server.py
```

## Roadmap

- Voice Processing History
- Batch Processing
- Additional Voice Models
- Analytics Dashboard
- Processing Metrics
