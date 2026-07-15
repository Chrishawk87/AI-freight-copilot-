#!/bin/bash
#
#  AI Freight Co-Pilot — stop everything
#  Double-click this if the app is still running and you want to force-stop it.
#
echo "Stopping AI Freight Co-Pilot..."
lsof -ti:4000 2>/dev/null | xargs kill -9 2>/dev/null
lsof -ti:3000 2>/dev/null | xargs kill -9 2>/dev/null
echo "Stopped. You can close this window."
sleep 1
