# Combined App: Gesture Synth Weld + Vibe DAW

This project combines two innovative music and audio applications:

- **Gesture Synth Weld** - A hand gesture-controlled music synthesizer that uses computer vision to create sound through natural hand movements
- **Vibe DAW** - An AI-powered digital audio workstation for music production

## Combined Features

### Gesture Synth Weld
- Hand tracking using MediaPipe for real-time music control
- Two-hand instrument with gesture-based chord and expression control
- Three modes: Gesture, Theremin, and MonoPiano
- Keyboard fallback for desktop use
- Recording and sharing capabilities
- Cross-platform web application

### Vibe DAW
- AI-powered music production with Gemini integration
- Complete DAW functionality: piano roll, sequencer, mixer, effects
- Agent-native design with inline AI editing (Ctrl+K)
- Reference track analysis and production recipe extraction
- Offline operation with IndexedDB project storage
- Firebase + Netlify production deployment

## Combined Architecture

Both applications share a common foundation:

### Core Technologies
- **React + TypeScript** - Component-based UI
- **Vite** - Fast development server and bundler
- **Tone.js** - Audio synthesis and processing
- **Firebase** - Authentication, cloud sync, and AI Logic
- **Netlify** - Production hosting with SPA routing
- **Cloudflare Pages** - Static asset hosting for gesture-synth
- **Gemini AI** - Music production and analysis

### Shared Components
- **Audio Engine** - Unified audio processing pipeline
- **State Management** - Project persistence and undo history
- **Authentication** - Secure user management
- **Deployment** - CI/CD pipelines and production hosting

## Project Structure

```
combined-app/
├── gesture-synth-app/          # Hand gesture music synthesizer
│   ├── src/                   # React source code
│   ├── public/               # Static assets
│   └── ...
├── vibe-daw/                   # AI-powered DAW
│   ├── src/                   # React source code
│   ├── mobile/               # React Native mobile app
│   ├── netlify/             # Netlify functions
│   └── ...
├── shared/                    # Common components and utilities
├── docs/                      # Documentation and guides
├── scripts/                   # Build and deployment scripts
└── README.md                  # This file
```

## Building and Running

### Prerequisites
- Node.js 18+
- Git
- Firebase CLI
- Google Gemini API key (optional for local development)

### Development Setup

```bash
# Install dependencies
cd combined-app
git clone https://github.com/rainbow686/gesture-synth-weld.git gesture-synth-app
git clone https://github.com/cristonj/Vibe-DAW.git vibe-daw

# Install dependencies for both projects
for project in gesture-synth-app vibe-daw; do
    cd "$project"
    npm ci
    cd ..
done

# Set up environment variables
cp gesture-synth-app/.env.example gesture-synth-app/.env.local
cp vibe-daw/.env.example vibe-daw/.env.local

# Start development servers
npm run dev
```

### Production Build

```bash
# Build both applications
cd gesture-synth-app
npm run build

# Deploy to Cloudflare Pages (if configured)
npx wrangler pages deploy dist --project-name gesture-synth-weld

cd ../vibe-daw
npm run build
npm run typecheck

# Deploy to Netlify
netlify deploy --prod
```

### Mobile Development

```bash
# Vibe DAW mobile app
cd vibe-daw/mobile
npm start

# iOS
cd vibe-daw/mobile
npx expo run:ios

# Android (requires additional setup)
cd vibe-daw/mobile
npx expo run:android
```

## Features

### Gesture Synth Weld
- **Hand Gesture Recognition**: MediaPipe-powered hand tracking for intuitive music control
- **Two-Hand Control**: Left hand for harmony (chords, key, mode), right hand for expression (volume, tone, octave)
- **Three Play Modes**: 
  - Gesture mode for two-hand chord playing
  - Theremin mode for pitch and volume control
  - MonoPiano mode for traditional keyboard input
- **Recording & Sharing**: Record up to 120 seconds with audio, video, and skeleton animation options
- **Cross-Platform**: Web-based application that works in any modern browser

### Vibe DAW
- **AI-Powered Production**: Gemini integration for automatic music creation and analysis
- **Full DAW Features**: Piano roll, step sequencer, mixer, effects, and more
- **Agent-Native Design**: Ctrl+K inline editing with AI-powered suggestions
- **Reference Track Analysis**: Extract production recipes from reference songs
- **Offline First**: Projects saved locally with IndexedDB, optional cloud sync
- **Professional Export**: High-quality audio export for commercial use

## Deployment

### Gesture Synth Weld
- **Primary**: Cloudflare Pages with immutable cache for MediaPipe models
- **Secondary**: Vercel for additional deployment options
- **CDN**: Asset delivery via CDN for global performance
- **Environment**: Production builds with optimized assets and SEO

### Vibe DAW
- **Frontend**: Netlify with Firebase AI Logic integration
- **Backend**: Firebase for authentication and cloud sync
- **Mobile**: Expo with native iOS and Android capabilities
- **CI/CD**: GitHub Actions for automated testing and deployment

## Technologies Used

### Frontend
- **React 19** - Component framework
- **TypeScript** - Type-safe development
- **Vite** - Fast build tooling
- **Tone.js** - Audio synthesis
- **Motion** - Animation library
- **Zustand** - State management

### Backend & Services
- **Firebase** - Authentication, Firestore, Storage
- **Gemini AI** - Music production and analysis
- **Netlify** - Hosting and serverless functions
- **Cloudflare Pages** - Static site hosting
- **GitHub Actions** - CI/CD

### Mobile
- **Expo** - React Native framework
- **React Native** - Cross-platform mobile development
- **WebView** - Web-based functionality
- **Native APIs** - Camera, microphone, haptics

## Project Roadmap

### Phase 1: Foundation (Current)
- Combined project setup
- Shared build configuration
- Unified documentation

### Phase 2: Integration
- Shared audio engine
- Unified authentication
- Cross-application features

### Phase 3: Advanced Features
- AI-powered music analysis
- Gesture-to-music conversion
- Collaborative music production

## License

This combined project is provided under the MIT License. Individual components may have their own licenses as specified in their respective package.json files.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Implement changes
4. Test thoroughly
5. Submit a pull request

## Support

For technical support, please check the documentation or create an issue in the respective GitHub repositories.

---

**Combined Application** - Powered by Gesture Synth Weld + Vibe DAW