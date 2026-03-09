import React, { useState, useEffect, useRef } from 'react';
import * as faceapi from 'face-api.js';
import Webcam from 'react-webcam';
import { Camera, UserPlus, ClipboardList, CheckCircle, AlertCircle, Download, Loader2, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Models CDN URL
const MODEL_URL = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights';

interface User {
  id: number;
  name: string;
  descriptor: string;
}

interface AttendanceRecord {
  id: number;
  name: string;
  period: number;
  timestamp: string;
}

export default function App() {
  const [isModelsLoaded, setIsModelsLoaded] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [activeTab, setActiveTab] = useState<'recognition' | 'register' | 'logs'>('recognition');
  const [registerName, setRegisterName] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [localImages, setLocalImages] = useState<string[]>([]);
  const [isScanning, setIsScanning] = useState(false);

  const webcamRef = useRef<Webcam>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadModels();
    fetchUsers();
    fetchAttendance();
    fetchLocalImages();
  }, []);

  const fetchLocalImages = async () => {
    try {
      const res = await fetch('/api/images');
      const data = await res.json();
      setLocalImages(data);
    } catch (error) {
      console.error(error);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !registerName) {
      if (!registerName) setStatus({ type: 'error', message: 'Please enter a name first' });
      return;
    }

    setIsRegistering(true);
    setStatus({ type: 'info', message: 'Processing image...' });

    try {
      const img = await faceapi.bufferToImage(file);
      const detection = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();

      if (!detection) {
        setStatus({ type: 'error', message: 'No face detected in the uploaded image.' });
        return;
      }

      await registerUser(registerName, Array.from(detection.descriptor));
    } catch (error) {
      console.error(error);
      setStatus({ type: 'error', message: 'Error processing image file' });
    } finally {
      setIsRegistering(false);
    }
  };

  const scanFolder = async () => {
    setIsScanning(true);
    setStatus({ type: 'info', message: 'Scanning images folder...' });
    let count = 0;

    try {
      for (const fileName of localImages) {
        const name = fileName.split('.')[0].replace(/_new$/, '').replace(/_/g, ' ');
        // Check if already registered
        if (users.some(u => u.name.toLowerCase() === name.toLowerCase())) continue;

        const img = await faceapi.fetchImage(`/images/${fileName}`);
        const detection = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();

        if (detection) {
          await registerUser(name, Array.from(detection.descriptor));
          count++;
        }
      }
      setStatus({ type: 'success', message: `Successfully imported ${count} new users from folder.` });
      fetchUsers();
    } catch (error) {
      console.error(error);
      setStatus({ type: 'error', message: 'Error during folder scan' });
    } finally {
      setIsScanning(false);
    }
  };

  const registerUser = async (name: string, descriptor: number[]) => {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, descriptor }),
    });

    if (res.ok) {
      setStatus({ type: 'success', message: `${name} registered successfully!` });
      setRegisterName('');
      fetchUsers();
    } else {
      setStatus({ type: 'error', message: 'Registration failed' });
    }
  };

  const loadModels = async () => {
    try {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
      ]);
      setIsModelsLoaded(true);
    } catch (error) {
      console.error("Error loading models:", error);
      setStatus({ type: 'error', message: 'Failed to load face recognition models. Please check your internet connection.' });
    }
  };

  const fetchUsers = async () => {
    const res = await fetch('/api/users');
    const data = await res.json();
    setUsers(data);
  };

  const fetchAttendance = async () => {
    const res = await fetch('/api/attendance');
    const data = await res.json();
    setAttendance(data);
  };

  const handleRegister = async () => {
    if (!registerName) {
      setStatus({ type: 'error', message: 'Please enter a name' });
      return;
    }

    if (!webcamRef.current) return;

    setIsRegistering(true);
    setStatus({ type: 'info', message: 'Detecting face...' });

    try {
      const imageSrc = webcamRef.current.getScreenshot();
      if (!imageSrc) throw new Error("Could not capture image");

      const img = await faceapi.fetchImage(imageSrc);
      const detection = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();

      if (!detection) {
        setStatus({ type: 'error', message: 'No face detected. Please try again.' });
        setIsRegistering(false);
        return;
      }

      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: registerName,
          descriptor: Array.from(detection.descriptor)
        }),
      });

      if (res.ok) {
        setStatus({ type: 'success', message: `${registerName} registered successfully!` });
        setRegisterName('');
        fetchUsers();
      } else {
        setStatus({ type: 'error', message: 'Registration failed' });
      }
    } catch (error) {
      console.error(error);
      setStatus({ type: 'error', message: 'Error during registration' });
    } finally {
      setIsRegistering(false);
    }
  };

  const startRecognition = async () => {
    if (!isModelsLoaded || users.length === 0 || isProcessing) return;
    
    setIsProcessing(true);
    
    const interval = setInterval(async () => {
      if (!webcamRef.current || activeTab !== 'recognition') {
        clearInterval(interval);
        setIsProcessing(false);
        return;
      }

      const video = webcamRef.current.video;
      if (!video) return;

      const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptors();

      if (detections.length > 0) {
        const faceMatcher = new faceapi.FaceMatcher(
          users.map(u => new faceapi.LabeledFaceDescriptors(u.name, [new Float32Array(JSON.parse(u.descriptor))])),
          0.6
        );

        detections.forEach(async (d) => {
          const bestMatch = faceMatcher.findBestMatch(d.descriptor);
          if (bestMatch.label !== 'unknown') {
            const user = users.find(u => u.name === bestMatch.label);
            if (user) {
              await markAttendance(user.id, user.name);
            }
          }
        });
      }
    }, 2000);
  };

  const markAttendance = async (userId: number, name: string) => {
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, name }),
      });
      const data = await res.json();
      if (res.ok && !data.alreadyMarked) {
        setStatus({ type: 'success', message: `Attendance marked for ${name}` });
        fetchAttendance();
        setTimeout(() => setStatus(null), 3000);
      }
    } catch (error) {
      console.error(error);
    }
  };

  const exportCSV = () => {
    window.location.href = '/api/export';
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 px-6 py-4 flex justify-between items-center sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-lg">
            <Camera className="text-white w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">FaceAttendance</h1>
        </div>
        <nav className="flex gap-1 bg-neutral-100 p-1 rounded-xl">
          <button 
            onClick={() => setActiveTab('recognition')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'recognition' ? 'bg-white shadow-sm text-indigo-600' : 'text-neutral-500 hover:text-neutral-700'}`}
          >
            Recognition
          </button>
          <button 
            onClick={() => setActiveTab('register')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'register' ? 'bg-white shadow-sm text-indigo-600' : 'text-neutral-500 hover:text-neutral-700'}`}
          >
            Register
          </button>
          <button 
            onClick={() => setActiveTab('logs')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'logs' ? 'bg-white shadow-sm text-indigo-600' : 'text-neutral-500 hover:text-neutral-700'}`}
          >
            Logs
          </button>
        </nav>
      </header>

      <main className="max-w-6xl mx-auto p-6">
        {/* Status Messages */}
        <AnimatePresence>
          {status && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={`mb-6 p-4 rounded-xl flex items-center gap-3 border ${
                status.type === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-700' :
                status.type === 'error' ? 'bg-rose-50 border-rose-100 text-rose-700' :
                'bg-indigo-50 border-indigo-100 text-indigo-700'
              }`}
            >
              {status.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
              <span className="text-sm font-medium">{status.message}</span>
              <button onClick={() => setStatus(null)} className="ml-auto text-current opacity-50 hover:opacity-100">×</button>
            </motion.div>
          )}
        </AnimatePresence>

        {!isModelsLoaded ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
            <p className="text-neutral-500 font-medium">Loading AI models...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left Column: Camera View */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden relative aspect-video bg-black flex items-center justify-center">
                {activeTab !== 'logs' ? (
                  <>
                    <Webcam
                      ref={webcamRef}
                      audio={false}
                      screenshotFormat="image/jpeg"
                      className="w-full h-full object-cover"
                      videoConstraints={{ facingMode: "user" }}
                      onUserMedia={() => {
                        if (activeTab === 'recognition') startRecognition();
                      }}
                      onUserMediaError={(err) => console.error(err)}
                      screenshotQuality={0.92}
                      mirrored={false}
                      imageSmoothing={true}
                      forceScreenshotSourceSize={false}
                      disablePictureInPicture={true}
                    />
                    <div className="absolute top-4 left-4 flex gap-2">
                      <span className="bg-black/50 backdrop-blur-md text-white px-3 py-1 rounded-full text-xs font-medium flex items-center gap-2">
                        <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                        Live Camera
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="text-neutral-400 flex flex-col items-center gap-2">
                    <ClipboardList className="w-12 h-12 opacity-20" />
                    <p>Camera inactive in Logs view</p>
                  </div>
                )}
              </div>

              {activeTab === 'recognition' && (
                <div className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm">
                  <h3 className="font-bold mb-2">Real-time Recognition</h3>
                  <p className="text-neutral-500 text-sm mb-4">
                    The system is automatically scanning for registered faces. When a match is found, attendance will be logged.
                  </p>
                  <div className="flex items-center gap-4">
                    <div className="flex -space-x-2">
                      {users.slice(0, 5).map((u, i) => (
                        <div key={i} className="w-8 h-8 rounded-full bg-indigo-100 border-2 border-white flex items-center justify-center text-[10px] font-bold text-indigo-600">
                          {u.name[0]}
                        </div>
                      ))}
                      {users.length > 5 && (
                        <div className="w-8 h-8 rounded-full bg-neutral-100 border-2 border-white flex items-center justify-center text-[10px] font-bold text-neutral-500">
                          +{users.length - 5}
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-neutral-400">{users.length} registered users</span>
                  </div>
                </div>
              )}

              {activeTab === 'register' && (
                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm space-y-4">
                    <h3 className="font-bold">Register via Webcam</h3>
                    <div className="flex gap-3">
                      <input 
                        type="text" 
                        placeholder="Enter full name"
                        value={registerName}
                        onChange={(e) => setRegisterName(e.target.value)}
                        className="flex-1 px-4 py-2 rounded-xl border border-neutral-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                      />
                      <button 
                        onClick={handleRegister}
                        disabled={isRegistering}
                        className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white px-6 py-2 rounded-xl font-medium transition-all flex items-center gap-2"
                      >
                        {isRegistering ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                        Capture & Register
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm">
                      <h3 className="font-bold mb-2">Upload Image</h3>
                      <p className="text-neutral-500 text-xs mb-4">Register a person by uploading an existing photo.</p>
                      <input 
                        type="file" 
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                        className="hidden"
                        accept="image/*"
                      />
                      <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full py-2 border-2 border-dashed border-neutral-200 rounded-xl text-neutral-500 hover:border-indigo-300 hover:text-indigo-600 transition-all flex items-center justify-center gap-2 text-sm font-medium"
                      >
                        <Download className="w-4 h-4 rotate-180" />
                        Select Image File
                      </button>
                    </div>

                    <div className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm">
                      <h3 className="font-bold mb-2">Bulk Import</h3>
                      <p className="text-neutral-500 text-xs mb-4">Scan the <code className="bg-neutral-100 px-1 rounded">/images</code> folder for new photos.</p>
                      <button 
                        onClick={scanFolder}
                        disabled={isScanning || localImages.length === 0}
                        className="w-full py-2 bg-neutral-900 hover:bg-black text-white rounded-xl transition-all flex items-center justify-center gap-2 text-sm font-medium disabled:opacity-50"
                      >
                        {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardList className="w-4 h-4" />}
                        Scan Folder ({localImages.length} files)
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: Sidebar */}
            <div className="space-y-6">
              {/* Stats Card */}
              <div className="bg-indigo-600 p-6 rounded-2xl text-white shadow-lg shadow-indigo-200">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="font-medium opacity-80">Today's Attendance</h3>
                  <ClipboardList className="w-5 h-5 opacity-60" />
                </div>
                <div className="text-4xl font-bold mb-1">
                  {attendance.filter(a => new Date(a.timestamp).toDateString() === new Date().toDateString()).length}
                </div>
                <p className="text-sm opacity-70">Total check-ins today</p>
              </div>

              {/* Recent Logs */}
              <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden flex flex-col h-[500px]">
                <div className="p-4 border-b border-neutral-100 flex justify-between items-center">
                  <h3 className="font-bold">Recent Logs</h3>
                  <button 
                    onClick={exportCSV}
                    className="text-indigo-600 hover:bg-indigo-50 p-2 rounded-lg transition-all"
                    title="Export to CSV"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {attendance.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-neutral-300 gap-2">
                      <ClipboardList className="w-8 h-8 opacity-20" />
                      <p className="text-xs">No records yet</p>
                    </div>
                  ) : (
                    attendance.map((record) => (
                      <div key={record.id} className="flex items-center justify-between p-3 rounded-xl hover:bg-neutral-50 transition-all group">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold text-xs">
                            {record.name[0]}
                          </div>
                          <div>
                            <div className="text-sm font-semibold">{record.name}</div>
                            <div className="text-[10px] text-neutral-400">
                              {record.period === 0 ? 'Outside Schedule' : `Class ${record.period}`} • {new Date(record.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        </div>
                        <div className="text-[10px] font-medium text-neutral-400 bg-neutral-100 px-2 py-1 rounded-md group-hover:bg-white transition-all">
                          {new Date(record.timestamp).toLocaleDateString()}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-6xl mx-auto p-6 mt-12 border-t border-neutral-200 flex flex-col md:flex-row justify-between items-center gap-4 text-neutral-400 text-sm">
        <p>© 2024 AI Attendance System. All rights reserved.</p>
        <div className="flex gap-6">
          <a href="#" className="hover:text-neutral-600">Privacy Policy</a>
          <a href="#" className="hover:text-neutral-600">Terms of Service</a>
          <a href="#" className="hover:text-neutral-600">Documentation</a>
        </div>
      </footer>
    </div>
  );
}
