(()=>{const PE=globalThis.PixelEditor; let seq=0; PE.model.nextId=(prefix='id')=>`${prefix}-${Date.now().toString(36)}-${(++seq).toString(36)}`; PE.model.resetIdSequenceForTest=()=>{seq=0;};})();
