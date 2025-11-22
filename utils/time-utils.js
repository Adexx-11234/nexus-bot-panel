export function getCurrentTimeAndGreeting() {
  const now = new Date()

  // Time formatting
  const time = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  })

  // Date formatting
  const date = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })

  // Greeting based on time
  const hour = now.getHours()
  let greeting

  if (hour >= 5 && hour < 12) {
    greeting = "Good Morning"
  } else if (hour >= 12 && hour < 17) {
    greeting = "Good Afternoon"
  } else if (hour >= 17 && hour < 21) {
    greeting = "Good Evening"
  } else {
    greeting = "Good Night"
  }

  return { time, date, greeting }
}

export function formatTime() {
  const now = new Date()
  return now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
}

export function formatUptime(seconds) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`
  } else {
    return `${secs}s`
  }
}

export function getLatency() {
  return Math.random() * 100 + 50 // Simulate latency between 50-150ms
}
