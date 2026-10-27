import { motion, MotionConfig, useReducedMotion, type Variants } from 'motion/react';
import { ArrowRight, Check, Code2, Download, Ear, Globe, Hand, Music2, Smartphone, Sparkles, Wand2, Zap } from 'lucide-react';
import { renderSVG } from 'uqr';

const APP = 'https://gesto-studio.unhumanx.workers.dev/';
const APK = 'https://github.com/humanx123/gesto-studio/releases/latest/download/gesto-studio.apk';
const REPO = 'https://github.com/humanx123/gesto-studio';
const img = (name: string) => `${import.meta.env.BASE_URL}capturas/${name}`;

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.6, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] } }),
};

function Reveal({ children, i = 0, className }: { children: React.ReactNode; i?: number; className?: string }) {
  return (
    <motion.div className={className} variants={fadeUp} custom={i} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-60px' }}>
      {children}
    </motion.div>
  );
}

function Nav() {
  return (
    <header className="nav-wrap">
      <nav className="nav" aria-label="Principal">
        <a className="logo" href="#inicio" aria-label="Gesto Studio, inicio">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={30} height={30} />
          <span>Gesto<b>Studio</b></span>
        </a>
        <div className="nav-links">
          <a href="#como">Cómo funciona</a>
          <a href="#capturas">Capturas</a>
          <a href="#ia">IA</a>
          <a href="#descargar">Descargar</a>
        </div>
        <a className="btn btn-primary btn-sm" href={APP}>Abrir la app</a>
      </nav>
    </header>
  );
}

/** Chord bubbles floating around the phone, like the live captions in the Linea template. */
function Bubble({ children, className, delay }: { children: React.ReactNode; className: string; delay: number }) {
  const still = useReducedMotion();
  return (
    <motion.div
      className={`bubble ${className}`}
      initial={{ opacity: 0, scale: 0.8, y: 10 }}
      animate={still ? { opacity: 1, scale: 1, y: 0 } : { opacity: 1, scale: 1, y: [0, -8, 0] }}
      transition={still ? { duration: 0.3, delay } : { opacity: { duration: 0.4, delay }, scale: { duration: 0.4, delay }, y: { duration: 4, delay, repeat: Infinity, ease: 'easeInOut' } }}
      aria-hidden="true"
    >
      {children}
    </motion.div>
  );
}

function Hero() {
  return (
    <section className="hero" id="inicio">
      <div className="hero-copy">
        <motion.p className="eyebrow" variants={fadeUp} initial="hidden" animate="show">Código abierto · Android y navegador</motion.p>
        <motion.h1 variants={fadeUp} custom={1} initial="hidden" animate="show">
          Toca con las manos.
          <span>Produce con IA.</span>
        </motion.h1>
        <motion.p className="lead" variants={fadeUp} custom={2} initial="hidden" animate="show">
          Arma acordes frente a la cámara y llévalos a un estudio completo donde un productor con IA, Gemini o Groq con tu propia clave, los convierte en canción.
        </motion.p>
        <motion.ul className="checks" variants={fadeUp} custom={3} initial="hidden" animate="show">
          <li><Check size={16} aria-hidden /> Gratis y sin cuenta</li>
          <li><Check size={16} aria-hidden /> Tus proyectos quedan en tu teléfono</li>
          <li><Check size={16} aria-hidden /> Licencia MIT</li>
        </motion.ul>
        <motion.div className="ctas" variants={fadeUp} custom={4} initial="hidden" animate="show">
          <a className="btn btn-primary" href={APP}><Globe size={18} aria-hidden /> Abrir en el navegador</a>
          <a className="btn btn-ghost" href={APK}><Download size={18} aria-hidden /> Descargar APK</a>
        </motion.div>
      </div>

      <div className="hero-visual">
        <div className="orb" aria-hidden="true" />
        <motion.div className="phone" initial={{ opacity: 0, y: 40, rotate: -4 }} animate={{ opacity: 1, y: 0, rotate: -4 }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}>
          <img src={img('producer.webp')} alt="El productor con IA de Gesto Studio agregando una melodía de flauta y revisando la mezcla" width={392} height={830} />
        </motion.div>
        <Bubble className="b1" delay={0.6}><Hand size={15} aria-hidden /> C · G · Am · F</Bubble>
        <Bubble className="b2" delay={0.9}><Sparkles size={15} aria-hidden /> Batería, bajo y acordes listos</Bubble>
        <Bubble className="b3" delay={1.2}><Music2 size={15} aria-hidden /> 92 BPM · Do mayor</Bubble>
      </div>
    </section>
  );
}

const STEPS = [
  { icon: Hand, title: 'Toca', text: 'La mano izquierda elige el grado del acorde y si es mayor o menor; la derecha, el volumen, el tono y la octava. Sin cámara, también con el teclado.' },
  { icon: ArrowRight, title: 'Llévalo al estudio', text: 'Gesto recuerda los acordes que mantienes. Un toque en «Al estudio» y el productor recibe tu progresión como pedido.' },
  { icon: Wand2, title: 'El productor la arma', text: 'Crea pistas, escribe notas, mezcla y te muestra cada cambio para que lo conserves o lo deshagas. Todo queda editable a mano.' },
];

function Steps() {
  return (
    <section className="section" id="como">
      <Reveal><h2>De tus manos a una canción, en tres pasos</h2></Reveal>
      <div className="steps">
        {STEPS.map((s, i) => (
          <Reveal key={s.title} i={i} className="step">
            <span className="step-icon"><s.icon size={22} aria-hidden /></span>
            <span className="step-n">0{i + 1}</span>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

const SHOTS = [
  { file: 'gesto.png', caption: 'Gesto: el instrumento que se toca con las manos', w: 1200, h: 630 },
  { file: 'studio.webp', caption: 'El estudio: arreglo, pistas y transporte', w: 1600, h: 1000 },
  { file: 'piano-roll.webp', caption: 'Piano roll para editar cada nota', w: 1600, h: 1000 },
  { file: 'drums.webp', caption: 'Secuenciador de batería por pasos', w: 1600, h: 1000 },
  { file: 'mixer.webp', caption: 'Mezclador con efectos por pista', w: 1600, h: 1000 },
];

function Shots() {
  return (
    <section className="section" id="capturas">
      <Reveal><h2>Un estudio entero, en tu teléfono</h2></Reveal>
      <Reveal i={1}><p className="sub">Capturas reales de las dos apps que une Gesto Studio. Desliza para ver más.</p></Reveal>
      <div className="shots" tabIndex={0} aria-label="Capturas, desplazables">
        {SHOTS.map((s) => (
          <figure key={s.file} className="shot">
            <img src={img(s.file)} alt={s.caption} loading="lazy" width={s.w} height={s.h} />
            <figcaption>{s.caption}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

function AiSection() {
  return (
    <section className="section" id="ia">
      <Reveal><h2>Tu IA, tu clave</h2></Reveal>
      <Reveal i={1}><p className="sub">La clave se guarda solo en tu dispositivo y va directo al proveedor. Elige en el inicio de la app o en Ajustes del estudio.</p></Reveal>
      <div className="ai-cards">
        <Reveal i={2} className="ai-card">
          <div className="ai-head"><Ear size={22} aria-hidden /><h3>Gemini</h3></div>
          <p>El productor completo: compone, edita y además <b>escucha</b> tu mezcla y tus sonidos para corregir lo que oye.</p>
          <a href="https://aistudio.google.com/apikey">Clave gratis en Google AI Studio →</a>
        </Reveal>
        <Reveal i={3} className="ai-card">
          <div className="ai-head"><Zap size={22} aria-hidden /><h3>Groq</h3></div>
          <p>Modelos abiertos muy rápidos (GPT-OSS, Qwen, Llama). Componen y editan; las notas de voz se transcriben con Whisper. No pueden escuchar audio.</p>
          <a href="https://console.groq.com/keys">Clave gratis en la consola de Groq →</a>
        </Reveal>
      </div>
    </section>
  );
}

function DownloadCta() {
  const qr = renderSVG(APK, { border: 1, whiteColor: '#ffffff', blackColor: '#0b0a14' });
  return (
    <section className="section" id="descargar">
      <Reveal className="cta-band">
        <div className="cta-copy">
          <h2>Llévalo en el bolsillo</h2>
          <p>El APK pesa 20 KB: abre la versión publicada, así que se actualiza solo. Pide cámara y micrófono únicamente cuando los usas.</p>
          <div className="ctas">
            <a className="btn btn-primary" href={APK}><Smartphone size={18} aria-hidden /> Descargar APK</a>
            <a className="btn btn-ghost" href={APP}><Globe size={18} aria-hidden /> Usar en el navegador</a>
          </div>
          <p className="fine">Android 7 o superior. Al instalar, Android puede pedirte permitir apps de origen desconocido.</p>
        </div>
        <figure className="qr">
          <div dangerouslySetInnerHTML={{ __html: qr }} />
          <figcaption>Escanéalo con el teléfono</figcaption>
        </figure>
      </Reveal>
    </section>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <p>
        Gesto Studio une <a href="https://github.com/rainbow686/gesture-synth-weld">Gesture Synth Weld</a> y <a href="https://github.com/cristonj/Vibe-DAW">Vibe DAW</a>, ambos con licencia MIT.
        Es una versión comunitaria, no oficial, de esos proyectos.
      </p>
      <p className="footer-links">
        <a href={REPO}><Code2 size={15} aria-hidden /> Código en GitHub</a>
        <span aria-hidden>·</span>
        <span>Hecho xhumanx + IA</span>
      </p>
    </footer>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <Nav />
      <main>
        <Hero />
        <Steps />
        <Shots />
        <AiSection />
        <DownloadCta />
      </main>
      <Footer />
    </MotionConfig>
  );
}
