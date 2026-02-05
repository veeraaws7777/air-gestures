
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Camera as CameraIcon, Eraser, Sparkles, Trash2, Palette, Settings2, Info, CheckCircle2, AlertCircle, Loader2, Zap } from 'lucide-react';
import { COLORS, BRUSH_SIZES } from './constants';
import { AppStatus, DrawingSettings } from './types';
import { analyzeCanvas } from './services/geminiService';

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [settings, setSettings] = useState<DrawingSettings>({ color: '#ffffff', brushSize: 5 });
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(true);
  const [currentSpeed, setCurrentSpeed] = useState(0);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef<HTMLCanvasElement>(null);
  
  // Refs for tracking state
  const isWritingRef = useRef(false);
  const prevPointRef = useRef<{ x: number; y: number; timestamp: number } | null>(null);
  const settingsRef = useRef<DrawingSettings>(settings);
  const cameraInstanceRef = useRef<any>(null);

  // Sync settings ref
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const clearCanvas = () => {
    const ctx = drawingRef.current?.getContext('2d');
    if (ctx && drawingRef.current) {
      ctx.clearRect(0, 0, drawingRef.current.width, drawingRef.current.height);
      setAiResponse(null);
    }
  };

  const handleAnalyze = async () => {
    if (!drawingRef.current) return;
    
    setStatus(AppStatus.ANALYZING);
    try {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = drawingRef.current.width;
      tempCanvas.height = drawingRef.current.height;
      const tCtx = tempCanvas.getContext('2d');
      if (tCtx) {
        // We draw onto a black background for the AI to see the strokes clearly
        tCtx.fillStyle = '#000000';
        tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        // Note: Canvas in CSS is mirrored, so we mirror back for the AI
        tCtx.save();
        tCtx.translate(tempCanvas.width, 0);
        tCtx.scale(-1, 1);
        tCtx.drawImage(drawingRef.current, 0, 0);
        tCtx.restore();
        
        const dataUrl = tempCanvas.toDataURL('image/png');
        const result = await analyzeCanvas(dataUrl);
        setAiResponse(result);
      }
    } catch (err) {
      console.error(err);
      setAiResponse("Failed to analyze canvas. Check your API key.");
    } finally {
      setStatus(AppStatus.TRACKING);
    }
  };

  const initTracking = useCallback(async () => {
    if (!videoRef.current || !overlayRef.current || !drawingRef.current) return;

    setStatus(AppStatus.LOADING);
    
    try {
      const hands = new (window as any).Hands({
        locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
      });

      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7
      });

      const onResults = (results: any) => {
        if (!overlayRef.current || !drawingRef.current) return;
        
        const canvasCtx = overlayRef.current.getContext('2d')!;
        const drawCtx = drawingRef.current.getContext('2d')!;
        const now = performance.now();
        
        canvasCtx.save();
        canvasCtx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
        
        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
          const landmarks = results.multiHandLandmarks[0];
          const indexTip = landmarks[8];
          const thumbTip = landmarks[4];

          const x = indexTip.x * overlayRef.current.width;
          const y = indexTip.y * overlayRef.current.height;

          // Velocity calculation
          let velocity = 0;
          if (prevPointRef.current) {
            const dx = x - prevPointRef.current.x;
            const dy = y - prevPointRef.current.y;
            const dt = (now - prevPointRef.current.timestamp) || 1;
            velocity = Math.sqrt(dx * dx + dy * dy) / dt; // pixels per ms
            // Smooth speed display
            setCurrentSpeed(prev => prev * 0.8 + velocity * 0.2);
          }

          // Gesture: Distance between index and thumb tip
          const dist = Math.sqrt(Math.pow(indexTip.x - thumbTip.x, 2) + Math.pow(indexTip.y - thumbTip.y, 2));
          const isPinching = dist < 0.05;

          // Feedback UI Cursor
          canvasCtx.beginPath();
          canvasCtx.arc(x, y, 12, 0, 2 * Math.PI);
          canvasCtx.fillStyle = !isPinching ? settingsRef.current.color : 'rgba(255,255,255,0.3)';
          canvasCtx.fill();
          canvasCtx.strokeStyle = 'white';
          canvasCtx.lineWidth = 2;
          canvasCtx.stroke();

          if (!isPinching) {
             if (!isWritingRef.current) {
               isWritingRef.current = true;
               prevPointRef.current = { x, y, timestamp: now };
             }
             
             if (prevPointRef.current) {
                // Dynamic stroke width based on speed: faster = thinner
                const speedFactor = Math.max(0.2, 1 - (velocity * 0.5));
                const dynamicWidth = settingsRef.current.brushSize * speedFactor;

                drawCtx.beginPath();
                drawCtx.moveTo(prevPointRef.current.x, prevPointRef.current.y);
                drawCtx.lineTo(x, y);
                drawCtx.strokeStyle = settingsRef.current.color;
                drawCtx.lineWidth = dynamicWidth;
                drawCtx.lineCap = 'round';
                drawCtx.lineJoin = 'round';
                drawCtx.stroke();
             }
             prevPointRef.current = { x, y, timestamp: now };
          } else {
             isWritingRef.current = false;
             prevPointRef.current = null;
          }
        } else {
          isWritingRef.current = false;
          prevPointRef.current = null;
          setCurrentSpeed(0);
        }
        canvasCtx.restore();
      };

      hands.onResults(onResults);

      const mpCamera = new (window as any).Camera(videoRef.current, {
        onFrame: async () => {
          if (videoRef.current) {
            await hands.send({ image: videoRef.current });
          }
        },
        width: 1280,
        height: 720
      });

      cameraInstanceRef.current = mpCamera;
      await mpCamera.start();
      setStatus(AppStatus.TRACKING);
    } catch (error) {
      console.error("Camera Init Error:", error);
      setStatus(AppStatus.ERROR);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (cameraInstanceRef.current) {
        cameraInstanceRef.current.stop();
      }
    };
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 font-sans selection:bg-violet-500/30">
      
      {/* FULLSCREEN CAMERA LAYER */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
        <video 
          ref={videoRef} 
          className="absolute inset-0 w-full h-full object-cover opacity-40 mix-blend-screen" 
          playsInline 
          muted 
        />
        <canvas 
          ref={overlayRef} 
          width={window.innerWidth} 
          height={window.innerHeight} 
          className="absolute inset-0 z-10 w-full h-full pointer-events-none"
        />
        <canvas 
          ref={drawingRef} 
          width={window.innerWidth} 
          height={window.innerHeight} 
          className="absolute inset-0 z-20 w-full h-full drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]"
        />
        {/* Subtle grid for depth */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none opacity-50" />
      </div>

      <div className="relative z-30 h-full flex flex-col pointer-events-none">
        
        <header className="p-6 flex justify-between items-start pointer-events-auto">
          <div className="flex items-center gap-3 bg-slate-900/80 backdrop-blur-md border border-slate-700/50 p-3 rounded-2xl shadow-2xl">
            <div className="w-10 h-10 bg-violet-600 rounded-xl flex items-center justify-center shadow-lg shadow-violet-500/20 animate-pulse">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white leading-none tracking-tight">AirWrite <span className="text-violet-400">Pro</span></h1>
              <p className="text-[10px] text-slate-400 mt-1 font-medium uppercase tracking-widest">Speed Sensing Canvas</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
             {status === AppStatus.TRACKING && (
               <div className="flex items-center gap-4 px-4 py-2 bg-slate-900/80 backdrop-blur-md border border-slate-700 rounded-2xl shadow-lg">
                  <div className="flex items-center gap-2">
                    <Zap className={`w-4 h-4 ${currentSpeed > 1 ? 'text-amber-400 animate-bounce' : 'text-slate-500'}`} />
                    <div className="flex flex-col">
                      <span className="text-[10px] text-slate-500 font-bold uppercase">Air Speed</span>
                      <span className="text-xs font-mono text-white">{(currentSpeed * 10).toFixed(1)} <span className="text-slate-500">px/s</span></span>
                    </div>
                  </div>
               </div>
             )}

             {status === AppStatus.IDLE && (
               <button 
                onClick={initTracking}
                className="flex items-center gap-2 px-6 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-2xl transition-all shadow-lg shadow-violet-500/30 active:scale-95 group"
               >
                 <CameraIcon className="w-5 h-5 group-hover:rotate-12 transition-transform" />
                 <span className="font-semibold">Activate Camera</span>
               </button>
             )}
          </div>
        </header>

        {aiResponse && (
          <div className="px-6 flex justify-center pointer-events-auto">
            <div className="max-w-xl w-full bg-slate-900/90 backdrop-blur-xl border border-violet-500/30 rounded-2xl p-4 shadow-2xl animate-in fade-in slide-in-from-top-4">
              <div className="flex items-center gap-2 text-violet-400 mb-2">
                <Sparkles className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-wider">Gemini Vision Analysis</span>
              </div>
              <p className="text-slate-200 text-sm leading-relaxed">{aiResponse}</p>
              <button 
                onClick={() => setAiResponse(null)}
                className="mt-3 text-xs text-slate-500 hover:text-white transition-colors underline decoration-dotted underline-offset-2"
              >
                Dismiss Response
              </button>
            </div>
          </div>
        )}

        <div className="flex-1" />

        <footer className="p-6 flex justify-center pointer-events-auto">
          <div className="flex items-center gap-4 bg-slate-900/90 backdrop-blur-2xl border border-slate-700/50 p-2 rounded-3xl shadow-2xl">
            
            <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-800/40 rounded-2xl">
              <Palette className="w-4 h-4 text-slate-500 mr-1" />
              {COLORS.map(color => (
                <button
                  key={color}
                  onClick={() => setSettings(prev => ({ ...prev, color }))}
                  className={`w-7 h-7 rounded-full transition-all hover:scale-110 active:scale-90 border-2 ${settings.color === color ? 'border-white scale-110 shadow-lg' : 'border-transparent shadow-none'}`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>

            <div className="w-px h-8 bg-slate-700 mx-1" />

            <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-800/40 rounded-2xl">
              <Settings2 className="w-4 h-4 text-slate-500 mr-1" />
              {BRUSH_SIZES.map(size => (
                <button
                  key={size}
                  onClick={() => setSettings(prev => ({ ...prev, brushSize: size }))}
                  className={`flex items-center justify-center w-7 h-7 rounded-lg transition-all hover:bg-slate-700 ${settings.brushSize === size ? 'bg-violet-600 text-white' : 'text-slate-400'}`}
                >
                  <div style={{ width: Math.max(2, size/2), height: Math.max(2, size/2) }} className="bg-current rounded-full" />
                </button>
              ))}
            </div>

            <div className="w-px h-8 bg-slate-700 mx-1" />

            <div className="flex items-center gap-2 pr-1">
              <button 
                onClick={clearCanvas}
                className="flex items-center gap-2 px-4 py-2 hover:bg-red-500/20 text-slate-400 hover:text-red-400 rounded-2xl transition-all group"
              >
                <Trash2 className="w-5 h-5 group-hover:rotate-12 transition-transform" />
                <span className="text-sm font-semibold">Clear</span>
              </button>
              
              <button 
                onClick={handleAnalyze}
                disabled={status === AppStatus.ANALYZING || status === AppStatus.IDLE}
                className={`flex items-center gap-2 px-6 py-2.5 bg-violet-600 text-white rounded-2xl transition-all shadow-lg shadow-violet-500/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed font-bold text-sm`}
              >
                {status === AppStatus.ANALYZING ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                <span>Ask Gemini</span>
              </button>
            </div>
          </div>
        </footer>

        <div className="absolute right-6 bottom-32 flex flex-col items-end gap-3 pointer-events-auto">
          {isMenuOpen && (
            <div className="w-64 bg-slate-900/90 backdrop-blur-md border border-slate-700 p-5 rounded-2xl shadow-2xl animate-in fade-in slide-in-from-right-4">
              <h3 className="text-sm font-bold text-white mb-3">Air Controls:</h3>
              <ul className="space-y-3">
                <li className="flex gap-3 text-xs text-slate-400">
                  <div className="w-5 h-5 shrink-0 bg-violet-500/20 rounded flex items-center justify-center text-violet-400 font-bold">1</div>
                  <span>Point <strong>index finger</strong> to draw. Speed affects stroke width.</span>
                </li>
                <li className="flex gap-3 text-xs text-slate-400">
                  <div className="w-5 h-5 shrink-0 bg-violet-500/20 rounded flex items-center justify-center text-violet-400 font-bold">2</div>
                  <span><strong>Pinch</strong> (index+thumb) to lift the pen.</span>
                </li>
                <li className="flex gap-3 text-xs text-slate-400">
                  <div className="w-5 h-5 shrink-0 bg-violet-500/20 rounded flex items-center justify-center text-violet-400 font-bold">3</div>
                  <span>Gemini interprets your air-writing.</span>
                </li>
              </ul>
              <div className="mt-4 pt-4 border-t border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2 text-[10px] text-slate-500 uppercase font-bold tracking-widest">
                  <Info className="w-3 h-3" />
                  <span>Developed by Veera</span>
                </div>
              </div>
            </div>
          )}
          <button 
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="w-12 h-12 bg-slate-900/80 hover:bg-slate-800 text-slate-400 rounded-full border border-slate-700 flex items-center justify-center transition-all shadow-xl"
          >
            {isMenuOpen ? <CheckCircle2 className="w-6 h-6" /> : <Info className="w-6 h-6" />}
          </button>
        </div>

      </div>

      {status === AppStatus.IDLE && (
        <div className="absolute inset-0 z-0 flex items-center justify-center">
          <div className="text-center space-y-4 max-w-md p-8 bg-slate-900/40 backdrop-blur-md rounded-3xl border border-white/5">
            <div className="w-20 h-20 bg-violet-600/20 rounded-full flex items-center justify-center mx-auto mb-6 border border-violet-500/20">
              <CameraIcon className="w-10 h-10 text-violet-500" />
            </div>
            <h2 className="text-3xl font-bold text-white">AirWrite <span className="text-violet-400">Pro</span></h2>
            <p className="text-slate-400 text-sm leading-relaxed">Turn your physical space into a digital canvas. We track your finger speed and position to create beautiful fluid strokes in mid-air.</p>
          </div>
        </div>
      )}

      {status === AppStatus.LOADING && (
        <div className="absolute inset-0 z-50 bg-slate-950/90 backdrop-blur-xl flex items-center justify-center">
          <div className="text-center">
            <div className="relative w-24 h-24 mx-auto mb-6">
              <Loader2 className="w-24 h-24 text-violet-500 animate-spin opacity-20" />
              <Sparkles className="absolute inset-0 m-auto w-10 h-10 text-violet-400 animate-pulse" />
            </div>
            <p className="text-lg font-bold text-white">Booting Tracking Engine...</p>
            <p className="text-sm text-slate-500 mt-2 font-mono">Calibrating Velocity Sensors</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
