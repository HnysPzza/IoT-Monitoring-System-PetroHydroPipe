import { useEffect, useState } from 'react'

export default function UpdatedAgo({ updatedAt }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  if (!updatedAt) return <>at an unknown time</>
  const seconds = Math.max(0, Math.floor((now - new Date(updatedAt).getTime()) / 1000))
  const amount = seconds < 60 ? seconds : seconds < 3600 ? Math.floor(seconds / 60) : Math.floor(seconds / 3600)
  const unit = seconds < 60 ? 'second' : seconds < 3600 ? 'minute' : 'hour'
  return <>{amount} {unit}{amount === 1 ? '' : 's'} ago</>
}
