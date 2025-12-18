import React from 'react';

interface NewBugProps {
  onBack: () => void;
  onOpenBugBase: () => void;
}

const NewBugD: React.FC<NewBugProps> = ({ onBack, onOpenBugBase }) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center animate-fade-in text-white bg-slate-900">
        <div className="w-32 h-32 flex items-center justify-center bg-violet-500/20 rounded-full mb-6">
            <span className="text-8xl animate-pulse">👾</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold mb-4 text-violet-400">The Feature</h1>
        <p className="max-w-md text-slate-300 text-lg mb-8 leading-relaxed">
            "It's not a bug, it's a feature." This rare entity transforms catastrophic errors into happy little accidents. It thrives in undocumented code.
        </p>
        <button 
            onClick={onOpenBugBase} 
            className="px-8 py-3 bg-violet-600 hover:bg-violet-500 text-white font-bold rounded-full transition-all duration-300 hover:scale-105 shadow-lg shadow-violet-600/50"
        >
            Run the Code
        </button>
    </div>
  )
}
export default NewBugD;