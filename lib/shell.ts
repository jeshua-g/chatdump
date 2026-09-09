export const HELP = `# Rooms
/ls                 List rooms
/rooms              List rooms + info
/myrooms            Rooms you own or are invited to
/mkdir <room>       Create a room (signed in)
/mkdir <room> private  Private room
/rmdir [room]       Delete a room you own
/inv <name>         Invite a user
/link               Invite URL for this room
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
/who                Who is in this room now
@name               Mention (Tab to complete)

# Chat
/clear              Clear terminal
/help               Show available commands
/noise              Toggle CRT static

# Voice
/voice              Join/leave room voice
/mute               Mute/unmute microphone
/deafen             Deafen/undeafen yourself`;

const SUDO = `
# Root
/sudo rmdir <room>  Delete any room
/sudo kick <nick>   Kick from this room
/sudo wall <text>   Broadcast in this room`;

const SUDO_NARROW = `
# Root
/sudo rmdir <room>
/sudo kick <nick>
/sudo wall <text>`;

export function helpText(narrow: boolean, admin: boolean) {
  const base = narrow ? HELP_NARROW : HELP;
  return admin ? `${base}${narrow ? SUDO_NARROW : SUDO}` : base;
}

export const HELP_NARROW = `# Rooms
/ls  list rooms
/rooms  rooms + info
/myrooms
/mkdir <room>
/mkdir <room> private
/rmdir [room]
/inv <name>
/link
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
@name  Tab to complete

# Chat
/clear
/help
/noise  CRT static

# Voice
/voice
/mute
/deafen`;

export function parseSsh(arg: string) {
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

export function authMenu(nick: string | null) {
  const who = nick
    ? `logged in · nick ${nick}\n(id is /whoami, not the nick)\n\n`
    : `not logged in · guest nick only\n\n`;
  return `ChatDump Authentication

${who}[1] Google
[2] GitHub`;
}
