# IoT-Based Pipe Manufacturing Machine Monitoring System

A real-time monitoring web application built for **Petro Hydro Pipe Corp.** to track its Spiral Mill pipe manufacturing machine. Five industrial proximity sensors connected to ESP32 microcontrollers watch the production line and report live machine status, downtime incidents, alerts, and finished pipe counts to plant supervisors and managers.

## What It Does

- **Live Machine & Sensor Monitoring:** Shows whether the Spiral Mill is running, idle, in downtime, or offline, updating live in the browser as factory conditions change.
- **Five Monitored Stations:**
  - **Raw Material & Coil Joint** — watches for raw steel strip presence.
  - **Inside Filler Wire** — monitors inside welding wire availability.
  - **Machine Main Sensor** — tracks main spindle rotation to confirm whether the machine is running.
  - **Outside Filler Wire** — monitors outside welding wire availability.
  - **Production Output Cutting** — counts each finished steel pipe as it is cut.
- **Downtime & Alerts:** Automatically opens downtime records and alerts when the main spindle stops or when all three material and wire sensors fault together, while respecting scheduled shift hours, breaks, and non-working days.
- **Production Logs & Reports:** Tracks pipe specifications (customer, diameter, thickness, length, pipe number, and tonnage), compares daily output, estimates production loss from unplanned stops, and exports reports to PDF and Excel.
- **Role-Based Access:** Supports five plant roles—Managing Director, Operation Manager, Production Supervisor, Engineering Supervisor, and Quality Control—with secure login, email-based account setup and password resets, and an audit trail of changes.

## What We Built It With

- **Web Dashboard:** Built with React and Vite for a responsive desktop and mobile interface.
- **Backend Server:** Built with Node.js and Express to handle user logins, sensor data intake, live browser updates, and report generation.
- **Database:** Powered by PostgreSQL on Supabase to store sensor readings, downtime history, alerts, production records, settings, and audit logs.
- **Email Service:** Uses Brevo to send account setup and password reset emails.
- **Factory Hardware:** Five ESP32 microcontrollers wired to inductive proximity sensors through optocouplers, sending encrypted updates over Wi-Fi with automatic retries when factory internet fluctuates.

## Technical Documentation

- [Documentation Index](docs/README.md)
- [System Architecture](docs/ARCHITECTURE.md)
- [Operations Runbook](docs/RUNBOOK.md)
- [Database Setup & Migrations](Backend/database/README.md)
- [Product Requirements Document](docs/PRD.md)
