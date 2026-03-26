// ====== DOM Elements ======
const screens = {
    welcome: document.getElementById('screen-welcome'),
    recording: document.getElementById('screen-recording'),
    analyzing: document.getElementById('screen-analyzing'),
    results: document.getElementById('screen-results')
};

const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const btnRestart = document.getElementById('btn-restart');
const canvas = document.getElementById('visualizer');
const canvasCtx = canvas.getContext('2d');

const statPitch = document.getElementById('stat-pitch');
const statVolume = document.getElementById('stat-volume');
const statStability = document.getElementById('stat-stability');
const resultProfile = document.getElementById('result-profile');
const resultDescription = document.getElementById('result-description');

// ====== Audio Context variables ======
let audioCtx;
let analyser;
let microphone;
let animationId;
let isRecording = false;

// Data to collect
let volumes = [];
let pitches = [];

// ======= Main Logic =======

btnStart.addEventListener('click', async () => {
    await startRecording();
});

btnStop.addEventListener('click', () => {
    stopRecording();
    processResults();
});

btnRestart.addEventListener('click', () => {
    switchScreen('welcome');
    volumes = [];
    pitches = [];
});

function switchScreen(screenName) {
    Object.values(screens).forEach(screen => {
        screen.classList.remove('active');
        screen.classList.add('hidden');
    });
    screens[screenName].classList.remove('hidden');
    screens[screenName].classList.add('active');
}

// Adjust canvas dimensions dynamically
function resizeCanvas() {
    const cr = canvas.getBoundingClientRect();
    canvas.width = cr.width;
    canvas.height = cr.height;
}
window.addEventListener('resize', resizeCanvas);


async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        
        switchScreen('recording');
        btnStop.classList.remove('hidden');
        
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        
        analyser.fftSize = 2048;
        microphone = audioCtx.createMediaStreamSource(stream);
        microphone.connect(analyser);
        
        isRecording = true;
        // give it a tiny delay to ensure screen changes render and canvas binds
        setTimeout(() => {
            resizeCanvas();
            drawVisualizer();
            collectData();
        }, 100);

    } catch (err) {
        console.error("Error al acceder al micrófono:", err);
        alert("Necesitamos acceso a tu micrófono para analizar tu voz. Si estás en modo incógnito o sin HTTPS, es posible que el navegador lo bloquee. Por favor, recarga y permítelo.");
    }
}

function drawVisualizer() {
    if (!isRecording) return;
    animationId = requestAnimationFrame(drawVisualizer);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    canvasCtx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = '#ec4899'; // Secondary color accent 
    canvasCtx.beginPath();

    const sliceWidth = canvas.width * 1.0 / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = v * canvas.height / 2;

        if (i === 0) {
            canvasCtx.moveTo(x, y);
        } else {
            canvasCtx.lineTo(x, y);
        }
        x += sliceWidth;
    }

    canvasCtx.lineTo(canvas.width, canvas.height / 2);
    canvasCtx.stroke();
}

function collectData() {
    if (!isRecording) return;
    
    // RMS Volume calculation
    const bufferLength = analyser.fftSize;
    const dataArray = new Float32Array(bufferLength);
    analyser.getFloatTimeDomainData(dataArray);
    
    let sumSquares = 0.0;
    for (let i = 0; i < bufferLength; i++) {
        sumSquares += dataArray[i] * dataArray[i];
    }
    const rms = Math.sqrt(sumSquares / bufferLength);

    // Only map data if voice is relatively present
    if(rms > 0.015) {
        volumes.push(rms);
        
        // Basic Auto-correlation for pitch estimation
        const pitch = autoCorrelate(dataArray, audioCtx.sampleRate);
        if (pitch !== -1 && pitch > 60 && pitch < 600) { // Valid human voice pitch range roughly
            pitches.push(pitch);
        }
    }
    
    setTimeout(collectData, 100); // 10 times a second
}

// Auto-correlation algorithm to find fundamental frequency (pitch)
function autoCorrelate(buf, sampleRate) {
    let SIZE = buf.length;
    let rms = 0;

    for (let i = 0; i < SIZE; i++) {
        let val = buf[i];
        rms += val * val;
    }
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) // Not enough signal
        return -1;

    let r1 = 0, r2 = SIZE - 1, thres = 0.2;
    for (let i = 0; i < SIZE / 2; i++)
        if (Math.abs(buf[i]) < thres) { r1 = i; break; }
    for (let i = 1; i < SIZE / 2; i++)
        if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; }

    buf = buf.slice(r1, r2);
    SIZE = buf.length;

    let c = new Array(SIZE).fill(0);
    for (let i = 0; i < SIZE; i++) {
        for (let j = 0; j < SIZE - i; j++) {
            c[i] = c[i] + buf[j] * buf[j + i];
        }
    }

    let d = 0; while (c[d] > c[d + 1]) d++;
    let maxval = -1, maxpos = -1;
    for (let i = d; i < SIZE; i++) {
        if (c[i] > maxval) {
            maxval = c[i];
            maxpos = i;
        }
    }
    let T0 = maxpos;

    let x1 = c[T0 - 1] || 0, x2 = c[T0] || 0, x3 = c[T0 + 1] || 0;
    let a = (x1 + x3 - 2 * x2) / 2;
    let b = (x3 - x1) / 2;
    if (a) T0 = T0 - b / (2 * a);

    return sampleRate / T0;
}

function stopRecording() {
    isRecording = false;
    cancelAnimationFrame(animationId);
    if(audioCtx) {
        // Stop capturing audio
        try {
            microphone.mediaStream.getTracks().forEach(track => track.stop());
        } catch(e) {}
        audioCtx.close();
    }
    btnStop.classList.add('hidden');
}

function processResults() {
    switchScreen('analyzing');
    
    setTimeout(() => {
        // Calculate averages
        const avgPitch = pitches.length > 0 ? pitches.reduce((a, b) => a + b, 0) / pitches.length : 0;
        const avgVol = volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0;
        
        // Stability (Lower standard deviation of pitch = higher stability)
        let pitchVariance = 0;
        if(pitches.length > 0) {
            const sumDeviations = pitches.reduce((sum, val) => sum + Math.pow(val - avgPitch, 2), 0);
            pitchVariance = sumDeviations / pitches.length;
        }
        const pitchStdDev = Math.sqrt(pitchVariance);
        // Map stability 0 to 100 based on standard dev (fewer std dev = more stable). Using conservative bounds.
        let stabilityScore = Math.max(0, Math.min(100, 100 - (pitchStdDev / 2))); 
        if(pitches.length < 5) stabilityScore = 0;
        
        renderResults(avgPitch, avgVol, stabilityScore);
        switchScreen('results');
    }, 2500); // UI delay for suspense
}

function renderResults(pitch, volume, stability) {
    if (pitch === 0) {
        statPitch.innerText = "N/A";
        statVolume.innerText = "N/A";
        statStability.innerText = "N/A";
        resultProfile.innerText = "No se detectó voz clara";
        resultDescription.innerText = "Parece que no hablaste lo suficiente o el volumen de tu entorno interfirió. Por favor, inténtalo de nuevo leyendo todo el texto.";
        return;
    }
    
    statPitch.innerText = Math.round(pitch) + " Hz";
    statVolume.innerText = Math.round(volume * 1000) + " %";
    statStability.innerText = Math.round(stability) + "/100";
    
    // Determine profile
    let profile = "";
    let desc = "";
    
    if (pitch < 120 && stability > 60) {
        profile = "Voz de Cine / Tráiler";
        desc = "¡Epicidad pura! Tienes tonos graves profundos y una excelente resonancia. Tu voz transmite autoridad y drama. Ideal para documentales impactantes o tráilers de películas.";
    } else if (pitch < 165 && volume > 0.05) {
        profile = "Voz de Radio FM / Podcast";
        desc = "Tu registro es cálido y equilibrado. Tienes una afinación muy amigable al oído, perfecta para mantener la atención de los oyentes por horas. ¡Espectacular para podcasts y radio!";
    } else if (pitch >= 165 && pitch < 220) {
        profile = "Voz Comercial / TV";
        desc = "Dinámica, brillante y clara. Tu voz tiene el color y la frecuencia ideal para comerciales de televisión donde se busca capturar la atención de inmediato de manera fresca y energética.";
    } else if (pitch >= 220) {
        profile = "Animación y Doblaje";
        desc = "Tienes tonos ligeramente agudos y brillantes que pueden adaptarse maravillosamente a la interpretación de perfiles juveniles, doblaje narrativo dinámico y personajes animados. ¡Muy expresiva!";
    } else {
        profile = "Voz Casual";
        desc = "Tienes un tono único que suena muy natural. ¡La industria de hoy en día busca voces reales y conversacionales! Con tu nivel, eres ideal para locución e-learning corporativa y audiolibros relax.";
    }

    if(stability < 50) {
        desc += " Notamos que el tono de tu voz varió bastante. Si intentabas ser expresivo ¡Genial! Si intentabas leer recto, practica un poco la estabilidad en tu respiración.";
    }
    
    resultProfile.innerText = profile;
    resultDescription.innerText = desc;
}
