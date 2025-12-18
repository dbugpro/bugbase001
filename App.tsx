
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import { Message, FileData, AnalysisResult, FormattingResult } from './types';
import { AGENT_NAME, SYSTEM_PROMPT } from './constants';

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [file, setFile] = useState<FileData | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [formatResult, setFormatResult] = useState<FormattingResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'workbench'>('chat');
  const [showToolSet, setShowToolSet] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeTab]);

  const addMessage = (role: 'AGENT' | 'USER' | 'SYSTEM', text: string) => {
    const newMessage: Message = {
      id: Date.now().toString(),
      role,
      text,
      timestamp: new Date().toLocaleTimeString(),
    };
    setMessages(prev => [...prev, newMessage]);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      setFile({
        name: uploadedFile.name,
        size: uploadedFile.size,
        type: uploadedFile.type || 'application/octet-stream',
        base64,
        lastModified: uploadedFile.lastModified,
      });
      setAnalysis(null);
      setFormatResult(null);
      addMessage('SYSTEM', `File mounted: ${uploadedFile.name} (${(uploadedFile.size / 1024).toFixed(2)} KB)`);
      addMessage('AGENT', `I've detected a new input stream: ${uploadedFile.name}. How would you like me to process this data?`);
      
      if (window.innerWidth < 768) {
        setActiveTab('workbench');
      }
    };
    reader.readAsDataURL(uploadedFile);
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsProcessing(false);
    addMessage('SYSTEM', 'ORCHESTRATION TERMINATED: User initiated manual override.');
  };

  const executeDbug = async (prompt: string) => {
    if (isProcessing) return;
    setIsProcessing(true);
    addMessage('USER', prompt);
    setInputValue('');

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const analyzeTool: FunctionDeclaration = {
      name: 'perform_structural_analysis',
      description: 'Analyze the structure of the provided file data and return metadata and a summary.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          signature: { type: Type.STRING, description: 'The detected file signature or magic numbers.' },
          summary: { type: Type.STRING, description: 'A brief summary of the content.' },
          isBinary: { type: Type.BOOLEAN, description: 'Whether the file appears to be binary.' }
        },
        required: ['signature', 'summary', 'isBinary']
      }
    };

    const formatTool: FunctionDeclaration = {
      name: 'apply_formatting_template',
      description: 'Format the file content into a structured text representation.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          content: { type: Type.STRING, description: 'The formatted content string.' },
          format: { type: Type.STRING, description: 'The name of the target format (e.g. JSON, CSV, MD).' },
          fileName: { type: Type.STRING, description: 'Suggested filename for export.' }
        },
        required: ['content', 'format', 'fileName']
      }
    };

    try {
      const parts: any[] = [{ text: prompt }];
      if (file) {
        parts.push({
          inlineData: {
            mimeType: file.type,
            data: file.base64
          }
        });
      }

      // Race the API call against a rejection if the controller is aborted
      const response = await Promise.race([
        ai.models.generateContent({
          model: 'gemini-3-pro-preview',
          contents: { parts },
          config: {
            systemInstruction: SYSTEM_PROMPT,
            tools: [{ functionDeclarations: [analyzeTool, formatTool] }]
          }
        }),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => reject(new Error('AbortError')));
        })
      ]);

      if (controller.signal.aborted) return;

      const calls = response.functionCalls;
      if (calls && calls.length > 0) {
        for (const call of calls) {
          if (call.name === 'perform_structural_analysis') {
            const result = call.args as any;
            setAnalysis({
              signature: result.signature,
              summary: result.summary,
              isBinary: result.isBinary,
              metadata: { "Size": `${(file?.size || 0)} bytes`, "Type": file?.type || 'unknown' }
            });
            addMessage('AGENT', `Analysis complete. Structural integrity verified. Check the workbench for details.`);
          } else if (call.name === 'apply_formatting_template') {
            const result = call.args as any;
            setFormatResult({
              content: result.content,
              format: result.format,
              fileName: result.fileName
            });
            addMessage('AGENT', `Formatting applied: [${result.format}]. The export stream is ready for download.`);
          }
        }
      } else {
        addMessage('AGENT', response.text || "Command processed with no structural changes.");
      }
    } catch (error: any) {
      if (error.message === 'AbortError') {
        // Silently catch as handleStop updates the UI
        return;
      }
      console.error(error);
      addMessage('SYSTEM', 'ERROR: Orchestration layer failed to respond. Check console.');
    } finally {
      if (!controller.signal.aborted) {
        setIsProcessing(false);
        abortControllerRef.current = null;
      }
    }
  };

  const handleDownload = () => {
    if (!formatResult) return;
    const blob = new Blob([formatResult.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = formatResult.fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col md:flex-row h-screen w-full bg-[#0a0a0c] text-slate-300 font-mono overflow-hidden relative">
      {/* Sidebar / Chat Pane */}
      <div className={`w-full md:w-1/2 flex flex-col border-r border-slate-800 bg-[#0d0d11] ${activeTab === 'chat' ? 'flex h-full' : 'hidden md:flex'}`}>
        <div className="p-4 border-b border-slate-800 flex justify-between items-start shrink-0">
          <div className="flex flex-col">
            <h1 className="text-cyan-400 font-bold tracking-widest text-lg">DBUG 001</h1>
            <button 
              onClick={() => setShowToolSet(true)}
              className="text-[10px] text-slate-500 hover:text-cyan-400 flex items-center mt-1 transition-colors group uppercase tracking-tight text-left"
            >
              <span className="mr-1.5 opacity-50 font-bold">◈</span> 
              DBUG TOOL SET 
              <span className="ml-1 opacity-50 group-hover:opacity-100 transition-opacity">+</span>
            </button>
          </div>
          <div className="flex items-center space-x-2 mt-1">
            <div className={`w-2 h-2 rounded-full ${isProcessing ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'}`}></div>
            <span className="text-[10px] text-slate-500 uppercase">{isProcessing ? 'Processing' : 'Standby'}</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-slate-800">
          {messages.length === 0 && (
            <div className="text-slate-600 text-xs italic opacity-50">
              [SYSTEM] INITIALIZING AGENT INTERFACE...<br/>
              [SYSTEM] WAITING FOR INPUT STREAM...
            </div>
          )}
          {messages.map(msg => (
            <div key={msg.id} className={`flex flex-col ${msg.role === 'USER' ? 'items-end' : 'items-start'}`}>
              <div className="flex items-baseline space-x-2 mb-1">
                <span className={`text-[10px] font-bold ${msg.role === 'USER' ? 'text-cyan-400' : msg.role === 'SYSTEM' ? 'text-yellow-600' : 'text-green-500'}`}>
                  {msg.role}
                </span>
                <span className="text-[9px] text-slate-700">{msg.timestamp}</span>
              </div>
              <div className={`p-3 text-sm max-w-[90%] rounded border ${
                msg.role === 'USER' 
                ? 'bg-cyan-950/20 border-cyan-800/50 text-cyan-50' 
                : msg.role === 'SYSTEM' 
                  ? 'bg-slate-900 border-slate-800 text-slate-400 font-bold italic text-xs' 
                  : 'bg-green-950/10 border-green-900/30 text-green-50'
              }`}>
                {msg.text}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        <form 
          onSubmit={(e) => { e.preventDefault(); executeDbug(inputValue); }}
          className="p-4 border-t border-slate-800 flex bg-black/20 shrink-0"
        >
          <input 
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            disabled={isProcessing}
            placeholder="Command dbug001..."
            className="flex-1 bg-transparent border-none outline-none text-cyan-100 placeholder-slate-700 text-sm py-2"
          />
          {isProcessing ? (
            <button 
              type="button"
              onClick={handleStop}
              className="ml-2 px-6 py-2 bg-red-600 hover:bg-red-500 text-white font-bold text-xs rounded transition-all active:scale-95 flex items-center space-x-2"
            >
              <span className="w-2 h-2 bg-white rounded-sm animate-pulse"></span>
              <span>STOP</span>
            </button>
          ) : (
            <button 
              type="submit"
              disabled={isProcessing || !inputValue.trim()}
              className="ml-2 px-6 py-2 bg-cyan-600 text-black font-bold text-xs rounded hover:bg-cyan-500 disabled:opacity-30 transition-all active:scale-95"
            >
              EXEC
            </button>
          )}
        </form>
      </div>

      {/* Main Workbench Pane */}
      <div className={`flex-1 flex flex-col p-4 md:p-6 space-y-4 md:space-y-6 overflow-y-auto bg-[#0a0a0c] ${activeTab === 'workbench' ? 'flex h-full' : 'hidden md:flex'}`}>
        <div className="flex justify-between items-center shrink-0">
          <h2 className="text-slate-500 text-[10px] md:text-xs font-bold uppercase tracking-widest">Workbench // Data Matrix</h2>
          <label className="cursor-pointer group flex items-center space-x-2 text-[10px] border border-slate-800 px-3 py-2 rounded bg-slate-900/50 hover:bg-slate-800 transition-colors active:scale-95">
            <span className="text-slate-400 uppercase font-bold">Mount New File</span>
            <input type="file" className="hidden" onChange={handleFileUpload} />
            <span className="text-cyan-500 group-hover:translate-y-[-1px] transition-transform">↑</span>
          </label>
        </div>

        {file ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 shrink-0">
            <div className="bg-slate-900/50 border border-slate-800 p-4 rounded flex items-center space-x-4">
              <div className="text-3xl md:text-4xl">📄</div>
              <div className="min-w-0">
                <div className="text-cyan-400 font-bold text-sm truncate">{file.name}</div>
                <div className="text-[9px] md:text-[10px] text-slate-500 uppercase tracking-tighter">
                  {file.type} // {(file.size / 1024).toFixed(2)} KB
                </div>
              </div>
            </div>
            {analysis && (
              <div className="bg-green-950/10 border border-green-900/30 p-4 rounded flex flex-col justify-center">
                <div className="text-[9px] md:text-[10px] text-green-500 font-bold uppercase mb-1">Structural Signature</div>
                <div className="text-sm text-green-100 font-bold truncate">{analysis.signature}</div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 border-2 border-dashed border-slate-800 rounded-xl flex flex-col items-center justify-center text-slate-600 space-y-4 min-h-[200px] md:min-h-[300px]">
            <div className="text-5xl md:text-6xl opacity-20">📁</div>
            <div className="text-[10px] md:text-xs uppercase tracking-widest font-bold text-center px-4">Drop or Select binary files to analyze</div>
          </div>
        )}

        {analysis && (
          <div className="bg-[#0d0d11] border border-slate-800 p-4 md:p-5 rounded-lg space-y-3 animate-fade-in shrink-0">
             <div className="flex items-center justify-between">
               <h3 className="text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-widest">Analysis Report</h3>
               <span className="text-[9px] bg-slate-800 px-2 py-0.5 rounded text-slate-500">RAW_MD_v1.0</span>
             </div>
             <p className="text-xs md:text-sm text-slate-300 leading-relaxed border-l-2 border-cyan-800 pl-4 py-1 italic">
               "{analysis.summary}"
             </p>
          </div>
        )}

        {formatResult && (
          <div className="flex-1 bg-black border border-cyan-900/30 rounded-lg flex flex-col animate-slide-up min-h-[300px]">
            <div className="p-3 border-b border-cyan-900/30 flex justify-between items-center bg-cyan-950/10 shrink-0">
              <span className="text-[9px] md:text-[10px] font-bold text-cyan-400">OUTPUT // FORMATted_{formatResult.format}</span>
              <button 
                onClick={handleDownload}
                className="text-[9px] md:text-[10px] bg-cyan-600 hover:bg-cyan-500 text-black px-3 py-1.5 rounded font-bold uppercase transition-colors active:scale-95"
              >
                Download Stream
              </button>
            </div>
            <div className="flex-1 p-4 overflow-auto scrollbar-thin scrollbar-thumb-cyan-900">
              <pre className="text-[10px] md:text-xs text-cyan-100/80 leading-5 whitespace-pre-wrap">
                {formatResult.content}
              </pre>
            </div>
          </div>
        )}
      </div>

      {/* Tool Set Modal Overlay */}
      {showToolSet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-2xl bg-[#0d0d11] border border-cyan-900/50 rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-cyan-900/30 flex justify-between items-center bg-cyan-950/10">
              <h2 className="text-cyan-400 font-bold text-sm tracking-widest uppercase">DBUG Sub-routine Library</h2>
              <button 
                onClick={() => setShowToolSet(false)}
                className="text-slate-500 hover:text-white transition-colors p-1"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-thin scrollbar-thumb-cyan-900">
              <div className="space-y-3">
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-green-500 rounded-full shadow-[0_0_5px_rgba(34,197,94,0.5)]"></div>
                  <h3 className="text-white font-bold text-xs uppercase tracking-wider">PRTCL_STRUCT_ANALYSIS</h3>
                </div>
                <div className="bg-black/40 border border-slate-800 p-4 rounded text-xs text-slate-400 leading-relaxed space-y-2">
                  <p><span className="text-cyan-600 font-bold">DESC:</span> Performs non-destructive deep inspection of binary headers, entropy levels, and segment structures.</p>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div className="bg-slate-900/50 p-2 rounded border border-slate-800/50">
                      <div className="text-[9px] text-slate-600 uppercase mb-1">Capabilities</div>
                      <ul className="list-disc list-inside space-y-1 text-[10px]">
                        <li>Magic Byte Identification</li>
                        <li>Structural Heuristics</li>
                        <li>MIME Verification</li>
                      </ul>
                    </div>
                    <div className="bg-slate-900/50 p-2 rounded border border-slate-800/50">
                      <div className="text-[9px] text-slate-600 uppercase mb-1">Status</div>
                      <div className="text-green-500 font-bold text-[10px]">ACTIVE // NOMINAL</div>
                      <div className="text-[9px] opacity-50 mt-1 italic">Version 2.4.0-rev3</div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-green-500 rounded-full shadow-[0_0_5px_rgba(34,197,94,0.5)]"></div>
                  <h3 className="text-white font-bold text-xs uppercase tracking-wider">PRTCL_DATA_REFORMAT</h3>
                </div>
                <div className="bg-black/40 border border-slate-800 p-4 rounded text-xs text-slate-400 leading-relaxed space-y-2">
                  <p><span className="text-cyan-600 font-bold">DESC:</span> State-aware reformatting engine capable of projecting unstructured memory dumps into standardized object notation.</p>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div className="bg-slate-900/50 p-2 rounded border border-slate-800/50">
                      <div className="text-[9px] text-slate-600 uppercase mb-1">Output Streams</div>
                      <ul className="list-disc list-inside space-y-1 text-[10px]">
                        <li>JSON_v12 (Object)</li>
                        <li>CSV_v4 (Tabular)</li>
                        <li>MD_LITE (Markup)</li>
                      </ul>
                    </div>
                    <div className="bg-slate-900/50 p-2 rounded border border-slate-800/50">
                      <div className="text-[9px] text-slate-600 uppercase mb-1">Latency</div>
                      <div className="text-cyan-400 font-bold text-[10px]">~45ms / 10kb</div>
                      <div className="text-[9px] opacity-50 mt-1 italic">Buffer: 4096-bit</div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="pt-4 border-t border-slate-800">
                <div className="text-[9px] text-slate-600 uppercase tracking-[0.2em] mb-4 font-bold">System Telemetry</div>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-xs font-bold text-cyan-500">99.8%</div>
                    <div className="text-[8px] text-slate-700 uppercase">Integrity</div>
                  </div>
                  <div>
                    <div className="text-xs font-bold text-yellow-500">12ms</div>
                    <div className="text-[8px] text-slate-700 uppercase">Jitter</div>
                  </div>
                  <div>
                    <div className="text-xs font-bold text-green-500">STABLE</div>
                    <div className="text-[8px] text-slate-700 uppercase">Kernel</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="p-4 bg-black/40 border-t border-cyan-900/20 flex justify-end">
              <button 
                onClick={() => setShowToolSet(false)}
                className="px-6 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-black font-bold text-[10px] rounded uppercase transition-colors"
              >
                Acknowledge
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Navigation Tab Bar */}
      <div className="md:hidden flex border-t border-slate-800 bg-[#0d0d11] shrink-0">
        <button 
          onClick={() => setActiveTab('chat')}
          className={`flex-1 py-4 flex flex-col items-center justify-center space-y-1 transition-colors ${activeTab === 'chat' ? 'bg-cyan-950/20 text-cyan-400' : 'text-slate-500'}`}
        >
          <span className="text-xl">💬</span>
          <span className="text-[9px] font-bold uppercase tracking-widest">Agent Chat</span>
          {activeTab === 'chat' && <div className="w-8 h-0.5 bg-cyan-400 mt-1 rounded-full"></div>}
        </button>
        <button 
          onClick={() => setActiveTab('workbench')}
          className={`flex-1 py-4 flex flex-col items-center justify-center space-y-1 transition-colors ${activeTab === 'workbench' ? 'bg-cyan-950/20 text-cyan-400' : 'text-slate-500'}`}
        >
          <span className="text-xl">🛠️</span>
          <span className="text-[9px] font-bold uppercase tracking-widest">Workbench</span>
          {activeTab === 'workbench' && <div className="w-8 h-0.5 bg-cyan-400 mt-1 rounded-full"></div>}
        </button>
      </div>

      <style>{`
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slide-up { from { transform: translateY(10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .animate-fade-in { animation: fade-in 0.3s ease-out forwards; }
        .animate-slide-up { animation: slide-up 0.4s ease-out forwards; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: #334155; }
        @media screen and (max-width: 768px) {
          input { font-size: 16px !important; }
        }
      `}</style>
    </div>
  );
};

export default App;
