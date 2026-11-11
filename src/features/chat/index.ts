// Public surface of the chat feature: the views the /app task routes render. The shell imports
// lib/composer-focus.ts directly, so the whole chat surface stays out of the shell chunk.

export { ChatView } from './components/chat-view';
export { HomeView } from './components/home-view';
