export const ROOMS: Record<string, string> = {
  guest: "public guest room  ·  messages expire ~24h",
};

export const HELP = `# Rooms
ls                  List rooms
rooms               List rooms + info
ssh user@room       Connect to a room
exit                Leave the current room
pwd                 Show current room

# Identity / Account
whoami              Show your nickname
nick <name>         Change nickname
auth                Login / manage authentication
passwd              Change password
logout              Log out

# People
who                 Show who's currently in the room

# Chat
clear               Clear terminal
help                Show available commands

# Voice
voice               Join/leave room voice
mute                Mute/unmute microphone
deafen              Deafen/undeafen yourself`;

export function parseSsh(arg: string) {
  const at = arg.lastIndexOf("@");
  if (at === -1) return { user: "", room: arg };
  return { user: arg.slice(0, at), room: arg.slice(at + 1) };
}

export function authMenu(signedIn: string | null) {
  const who = signedIn ? `signed in as ${signedIn}\n\n` : "";
  return `ChatDump Authentication

${who}[1] Google
[2] GitHub`;
}
