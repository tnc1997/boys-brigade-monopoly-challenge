// The setup form (#12) and stop list (#13) use these modules.
import { plan } from './planner.js';
import { loadState, saveState } from './storage.js';
import { parseWords } from './what3words.js';

/** The app's state, loaded from the previous visit if there was one. */
const state = loadState();
