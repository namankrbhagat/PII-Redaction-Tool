import React, { useState, useEffect } from 'react';

const BACKEND_URL = 'http://localhost:3001';

export default function App() {
  const [file, setFile] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | processing | success | error
  const [errorMsg, setErrorMsg] = useState('');
  const [stats, setStats] = useState(null);
  const [redactedFileUrl, setRedactedFileUrl] = useState(null);
  const [redactedFileName, setRedactedFileName] = useState('');
  const [backendStatus, setBackendStatus] = useState('checking'); // checking | online | offline

  // Check backend server connection on mount
  useEffect(() => {
    fetch(`${BACKEND_URL}/health`)
      .then(res => {
        if (res.ok) setBackendStatus('online');
        else setBackendStatus('offline');
      })
      .catch(() => setBackendStatus('offline'));
  }, []);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      validateAndSetFile(droppedFile);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const validateAndSetFile = (selectedFile) => {
    const validExtensions = ['.pdf', '.docx'];
    const fileName = selectedFile.name.toLowerCase();
    const isValid = validExtensions.some(ext => fileName.endsWith(ext));

    if (!isValid) {
      setErrorMsg('Invalid file type. Please upload a PDF or DOCX file.');
      setStatus('error');
      setFile(null);
      return;
    }

    setFile(selectedFile);
    setStatus('idle');
    setErrorMsg('');
    setStats(null);
    setRedactedFileUrl(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return;

    setStatus('processing');
    setErrorMsg('');
    setStats(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${BACKEND_URL}/redact`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server returned status ${response.status}`);
      }

      // Read filename from Content-Disposition
      const disposition = response.headers.get('Content-Disposition');
      let outputFileName = `redacted_${file.name}`;
      if (disposition && disposition.indexOf('filename=') !== -1) {
        const matches = disposition.match(/filename="?([^"]+)"?/);
        if (matches && matches[1]) {
          outputFileName = decodeURIComponent(matches[1]);
        }
      }
      setRedactedFileName(outputFileName);

      // Parse custom base64-encoded stats header
      const statsHeader = response.headers.get('X-Redaction-Stats');
      if (statsHeader) {
        try {
          const statsJson = atob(statsHeader);
          setStats(JSON.parse(statsJson));
        } catch (err) {
          console.error('Failed to parse redaction stats:', err);
        }
      }

      // Convert response stream to blob download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      setRedactedFileUrl(url);
      setStatus('success');

      // Auto trigger download for ease of use
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', outputFileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

    } catch (err) {
      console.error('Processing failed:', err);
      setErrorMsg(err.message || 'An error occurred during text redaction.');
      setStatus('error');
    }
  };

  const resetState = () => {
    setFile(null);
    setStatus('idle');
    setErrorMsg('');
    setStats(null);
    setRedactedFileUrl(null);
  };

  // Human readable file size formatter
  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Header Section */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.75rem' }}>🛡️</span>
          <h1 style={{ fontSize: '1.25rem', fontWeight: '700', letterSpacing: '-0.025em' }}>
            AEGIS<span className="gradient-text" style={{ fontWeight: '800' }}>REDACT</span>
          </h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: backendStatus === 'online' ? '#10b981' : backendStatus === 'checking' ? '#f59e0b' : '#ef4444'
          }} />
          <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: '500' }}>
            Backend: {backendStatus.toUpperCase()}
          </span>
        </div>
      </header>

      {/* Main Grid Content */}
      <main style={{ flex: '1', padding: '3rem 2rem', maxWidth: '1200px', width: '100%', margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2.5rem' }}>
        {/* Left Side: Upload Panel */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="glass-panel" style={{ padding: '2rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '0.5rem' }}>Upload Document</h2>
            <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              Select a PDF or DOCX file to run through our PII Redaction Pipeline. Files are processed in memory and never persisted.
            </p>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div 
                className={`dropzone ${dragActive ? 'active' : ''}`}
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={() => document.getElementById('file-upload-input').click()}
              >
                <input 
                  id="file-upload-input"
                  type="file" 
                  accept=".pdf,.docx" 
                  style={{ display: 'none' }} 
                  onChange={handleFileChange} 
                />
                
                <span className="dropzone-icon">📥</span>
                
                {file ? (
                  <div>
                    <p style={{ fontWeight: '600', color: '#a78bfa' }}>{file.name}</p>
                    <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.25rem' }}>
                      {formatBytes(file.size)}
                    </p>
                  </div>
                ) : (
                  <div>
                    <p style={{ fontWeight: '500' }}>Drag & drop file here, or <span style={{ color: '#a78bfa', textDecoration: 'underline' }}>browse</span></p>
                    <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.25rem' }}>
                      Supports PDF or DOCX up to 15MB
                    </p>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <button 
                  type="submit" 
                  className="btn-primary" 
                  disabled={!file || status === 'processing' || backendStatus !== 'online'}
                >
                  {status === 'processing' ? (
                    <>
                      <div className="spinner" />
                      Redacting...
                    </>
                  ) : (
                    <>
                      <span>🛡️</span>
                      Redact Document
                    </>
                  )}
                </button>
                
                {file && status !== 'processing' && (
                  <button 
                    type="button" 
                    onClick={resetState}
                    style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#f8fafc', padding: '0.8rem 1.2rem', borderRadius: '8px', cursor: 'pointer' }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* Status Banners */}
          {status === 'processing' && (
            <div className="glass-panel" style={{ padding: '1.25rem', borderColor: 'rgba(139,92,246,0.3)', background: 'rgba(139,92,246,0.05)' }}>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <div className="spinner" />
                <div>
                  <p style={{ fontWeight: '600' }}>Running Redaction Pipeline</p>
                  <p style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Extracting text, resolving NLP models, mapping fake values, and rendering Word document...</p>
                </div>
              </div>
            </div>
          )}

          {status === 'error' && (
            <div className="glass-panel" style={{ padding: '1.25rem', borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.05)' }}>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <span style={{ fontSize: '1.5rem', color: '#ef4444' }}>⚠️</span>
                <div>
                  <p style={{ fontWeight: '600', color: '#ef4444' }}>Pipeline Error</p>
                  <p style={{ fontSize: '0.8rem', color: '#f87171' }}>{errorMsg}</p>
                </div>
              </div>
            </div>
          )}

          {status === 'success' && (
            <div className="glass-panel" style={{ padding: '1.25rem', borderColor: 'rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.05)' }}>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  <span style={{ fontSize: '1.5rem', color: '#10b981' }}>✅</span>
                  <div>
                    <p style={{ fontWeight: '600', color: '#10b981' }}>Redaction Successful</p>
                    <p style={{ fontSize: '0.8rem', color: '#a7f3d0' }}>Document downloaded successfully!</p>
                  </div>
                </div>
                {redactedFileUrl && (
                  <a 
                    href={redactedFileUrl} 
                    download={redactedFileName}
                    className="btn-primary"
                    style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                  >
                    Download Again
                  </a>
                )}
              </div>
            </div>
          )}
        </section>

        {/* Right Side: Information & Stats Panel */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Metrics dashboard shown after successful redaction */}
          {status === 'success' && stats ? (
            <div className="glass-panel" style={{ padding: '2rem' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '0.25rem' }}>Redaction Metrics</h2>
              <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                Summary of unique PII entities resolved and replaced throughout the document.
              </p>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                {Object.entries(stats).map(([type, count]) => {
                  // Map database keys to user friendly labels
                  const labelMap = {
                    name: 'Full Names',
                    email: 'Email Addresses',
                    phone: 'Phone Numbers',
                    company: 'Companies',
                    address: 'Addresses',
                    ssn: 'US SSNs',
                    pan: 'Indian PANs',
                    gstin: 'Indian GSTINs',
                    creditCard: 'Credit Cards',
                    dob: 'Dates of Birth',
                    ip: 'IP Addresses'
                  };
                  
                  if (count === 0) return null;

                  return (
                    <div key={type} className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem' }}>
                      <div>
                        <p style={{ fontSize: '0.8rem', color: '#94a3b8', textTransform: 'capitalize' }}>
                          {labelMap[type] || type}
                        </p>
                        <p style={{ fontSize: '1.5rem', fontWeight: '700', marginTop: '0.15rem' }} className="gradient-text">
                          {count}
                        </p>
                      </div>
                      <span style={{ fontSize: '1.5rem', opacity: 0.8 }}>
                        {type === 'name' ? '👤' : 
                         type === 'email' ? '📧' : 
                         type === 'phone' ? '📞' : 
                         type === 'company' ? '🏢' : 
                         type === 'address' ? '📍' : 
                         type === 'dob' ? '📅' : '🔒'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="glass-panel" style={{ padding: '2rem', height: '100%' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '0.5rem' }}>Supported PII Classes</h2>
              <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                The tool employs a hybrid approach combining regular expression matching (structured) and Compromise NLP (unstructured context) to detect:
              </p>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '2rem' }}>
                <span className="mono-tag">👤 Full Names</span>
                <span className="mono-tag">🏢 Company Names</span>
                <span className="mono-tag">📍 Physical Addresses</span>
                <span className="mono-tag">📧 Email Addresses</span>
                <span className="mono-tag">📞 Phone Numbers</span>
                <span className="mono-tag">📅 Dates of Birth</span>
                <span className="mono-tag">🔒 SSN (US)</span>
                <span className="mono-tag">💳 Credit Cards</span>
                <span className="mono-tag">🌐 IP Addresses</span>
                <span className="mono-tag">🇮🇳 PAN (India)</span>
                <span className="mono-tag">🧾 GSTIN (India)</span>
              </div>
            </div>
          )}
        </section>
      </main>

      {/* Footer Section */}
      <footer>
        <p>Aegis Redact Secure Sandbox — Client-Side Session. No files are saved on disk.</p>
      </footer>
    </div>
  );
}
