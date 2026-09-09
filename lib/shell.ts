export const HELP = `# Rooms
/ls                 List rooms
/rooms              List rooms + info
/mkdir <room>       Create a room (signed in)
/mkdir <room> private  Private room
/inv <name>         Invite a user
/ssh user@room      Connect to a room
/exit               Leave the current room
/pwd                Show current room

# Identity / Account
/whoami             Show your nickname
/nick <name>        Change nickname
/auth               Login / manage authentication
/passwd             Change password
/logout             Log out

# People
/who                Show who's currently in the room

# Chat
/clear              Clear terminal
/help               Show available commands

# Voice
/voice              Join/leave room voice
/mute               Mute/unmute microphone
/deafen             Deafen/undeafen yourself`;

export const HELP_NARROW = `# Rooms
/ls  list rooms
/rooms  rooms + info
/mkdir <room>
/mkdir <room> private
/inv <name>
/ssh user@room
/exit  leave room
/pwd  current room

# Identity
/whoami
/nick <name>
/auth  login
/passwd
/logout

# People
/who  in this room

# Chat
/clear
/help

# Voice
/voice
/mute
/deafen`;
  const at = arg.lastIndexOf("@");
  if (at === -1) return { user: "", room: arg };
  return { user: arg.slice(0, at), room: arg.slice(at + 1) };
}

export function parseRoomId(raw: string) {
  const id = raw.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,23}$/.test(id)) return null;
  return id;
}

export function privateMenu() {
  return `[1] pswd
[2] inv only`;
}

export function authMenu(signedIn: string | null) {
  const who = signedIn ? `signed in as ${signedIn}\n\n` : "";
  return `ChatDump Authentication

${who}[1] Google
[2] GitHub`;
}
