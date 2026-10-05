import * as commands from '../commands/index.js';
import * as clipboard from '../clipboard/element-clipboard.js';

const PE = globalThis.PixelEditor;
Object.assign(PE.commands, commands);
PE.commandCoalescing = {
  normalizeMergeDescriptor: commands.normalizeMergeDescriptor,
  mergeDescriptorKey: commands.mergeDescriptorKey,
  resolveMergeDescriptor: commands.resolveMergeDescriptor,
  diffLeafPaths: commands.diffLeafPaths,
  attachSelectionBoundary: commands.attachSelectionBoundary,
};
PE.interaction.Clipboard = clipboard.ElementClipboard;
PE.ElementClipboard = clipboard.ElementClipboard;
PE.elementClipboard = clipboard;
