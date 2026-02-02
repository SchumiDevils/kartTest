import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'

// BLE UUIDs - adjust these to match your kart's BLE service
const BLE_SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b'
const SERVO_CHARACTERISTIC_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8'
const MOTOR_CHARACTERISTIC_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a9'

function App() {
  // BLE State
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [deviceName, setDeviceName] = useState('')
  const [bleError, setBleError] = useState('')
  
  // Control State
  const [steeringAngle, setSteeringAngle] = useState(90) // 0-180, 90 is center
  const [motorSpeed, setMotorSpeed] = useState(0) // -100 to 100 (negative = reverse)
  const [accelerometerEnabled, setAccelerometerEnabled] = useState(false)
  const [accelerometerData, setAccelerometerData] = useState({ x: 0, y: 0, z: 0 })
  
  // Refs for BLE
  const deviceRef = useRef(null)
  const servoCharRef = useRef(null)
  const motorCharRef = useRef(null)
  const throttleIntervalRef = useRef(null)
  const brakeIntervalRef = useRef(null)

  // Connect to BLE device
  const connectBLE = async () => {
    try {
      setIsConnecting(true)
      setBleError('')
      
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [BLE_SERVICE_UUID] }],
        optionalServices: [BLE_SERVICE_UUID]
      })
      
      deviceRef.current = device
      setDeviceName(device.name || 'Kart')
      
      device.addEventListener('gattserverdisconnected', () => {
        setIsConnected(false)
        setDeviceName('')
        servoCharRef.current = null
        motorCharRef.current = null
      })
      
      const server = await device.gatt.connect()
      const service = await server.getPrimaryService(BLE_SERVICE_UUID)
      
      servoCharRef.current = await service.getCharacteristic(SERVO_CHARACTERISTIC_UUID)
      motorCharRef.current = await service.getCharacteristic(MOTOR_CHARACTERISTIC_UUID)
      
      setIsConnected(true)
      setIsConnecting(false)
    } catch (error) {
      console.error('BLE Connection Error:', error)
      setBleError(error.message)
      setIsConnecting(false)
    }
  }

  // Disconnect from BLE device
  const disconnectBLE = () => {
    if (deviceRef.current?.gatt?.connected) {
      deviceRef.current.gatt.disconnect()
    }
    setIsConnected(false)
  }

  // Send steering angle to servo
  const sendSteeringAngle = useCallback(async (angle) => {
    if (servoCharRef.current && isConnected) {
      try {
        const value = new Uint8Array([Math.round(angle)])
        await servoCharRef.current.writeValue(value)
      } catch (error) {
        console.error('Servo write error:', error)
      }
    }
  }, [isConnected])

  // Send motor speed
  const sendMotorSpeed = useCallback(async (speed) => {
    if (motorCharRef.current && isConnected) {
      try {
        // Convert -100 to 100 range to 0-200 for unsigned byte
        const value = new Uint8Array([Math.round(speed + 100)])
        await motorCharRef.current.writeValue(value)
      } catch (error) {
        console.error('Motor write error:', error)
      }
    }
  }, [isConnected])

  // Handle accelerometer for steering
  useEffect(() => {
    if (!accelerometerEnabled) return

    const handleOrientation = (event) => {
      // gamma is left-right tilt in landscape (-90 to 90)
      const gamma = event.gamma || 0
      const beta = event.beta || 0
      
      setAccelerometerData({ 
        x: gamma.toFixed(1), 
        y: beta.toFixed(1), 
        z: 0 
      })
      
      // Map gamma (-45 to 45) to servo angle (0 to 180)
      // Clamping the tilt range for comfortable control
      const clampedGamma = Math.max(-45, Math.min(45, gamma))
      const angle = Math.round(((clampedGamma + 45) / 90) * 180)
      
      setSteeringAngle(angle)
      sendSteeringAngle(angle)
    }

    // Request permission for iOS 13+
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission()
        .then(permission => {
          if (permission === 'granted') {
            window.addEventListener('deviceorientation', handleOrientation)
          }
        })
        .catch(console.error)
    } else {
      window.addEventListener('deviceorientation', handleOrientation)
    }

    return () => {
      window.removeEventListener('deviceorientation', handleOrientation)
    }
  }, [accelerometerEnabled, sendSteeringAngle])

  // Send motor speed when it changes
  useEffect(() => {
    sendMotorSpeed(motorSpeed)
  }, [motorSpeed, sendMotorSpeed])

  // Throttle handlers with continuous acceleration
  const startThrottle = () => {
    if (throttleIntervalRef.current) return
    throttleIntervalRef.current = setInterval(() => {
      setMotorSpeed(prev => Math.min(100, prev + 5))
    }, 50)
  }

  const stopThrottle = () => {
    if (throttleIntervalRef.current) {
      clearInterval(throttleIntervalRef.current)
      throttleIntervalRef.current = null
    }
  }

  // Brake handlers with continuous deceleration
  const startBrake = () => {
    if (brakeIntervalRef.current) return
    brakeIntervalRef.current = setInterval(() => {
      setMotorSpeed(prev => Math.max(-100, prev - 5))
    }, 50)
  }

  const stopBrake = () => {
    if (brakeIntervalRef.current) {
      clearInterval(brakeIntervalRef.current)
      brakeIntervalRef.current = null
    }
  }

  // Emergency stop
  const emergencyStop = () => {
    setMotorSpeed(0)
    sendMotorSpeed(0)
  }

  // Enable accelerometer with permission request
  const enableAccelerometer = async () => {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const permission = await DeviceOrientationEvent.requestPermission()
        if (permission === 'granted') {
          setAccelerometerEnabled(true)
        }
      } catch (error) {
        console.error('Accelerometer permission error:', error)
        setBleError('Accelerometer permission denied')
      }
    } else {
      setAccelerometerEnabled(true)
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopThrottle()
      stopBrake()
    }
  }, [])

  return (
    <div className="kart-controller">
      {/* Main Controller UI - Always visible */}
      <div className="controller-layout">
          {/* Left Panel - Brake */}
          <div className="control-panel left-panel">
            <button
              className={`pedal-btn brake-btn ${motorSpeed < 0 ? 'active' : ''}`}
              onTouchStart={startBrake}
              onTouchEnd={stopBrake}
              onMouseDown={startBrake}
              onMouseUp={stopBrake}
              onMouseLeave={stopBrake}
            >
              <span className="pedal-icon">🛑</span>
              <span className="pedal-label">BRAKE</span>
            </button>
          </div>

          {/* Center Panel - Info & Controls */}
          <div className="center-panel">
            {/* Top Bar */}
            <div className="top-bar">
              {isConnected ? (
                <div className="device-info">
                  <span className="status-dot"></span>
                  <span>{deviceName}</span>
                </div>
              ) : (
                <button 
                  className="connect-btn-small"
                  onClick={connectBLE}
                  disabled={isConnecting}
                >
                  {isConnecting ? (
                    <>
                      <span className="spinner-small"></span>
                      <span>Connecting...</span>
                    </>
                  ) : (
                    <>
                      <span className="bt-icon-small">📡</span>
                      <span>Connect</span>
                    </>
                  )}
                </button>
              )}
              {isConnected && (
                <button className="disconnect-btn" onClick={disconnectBLE}>
                  ✕
                </button>
              )}
              {bleError && (
                <div className="error-toast">{bleError}</div>
              )}
            </div>

            {/* Steering Visualization */}
            <div className="steering-display">
              <div className="steering-wheel" style={{ transform: `rotate(${steeringAngle - 90}deg)` }}>
                <div className="wheel-inner">
                  <div className="wheel-spoke"></div>
                  <div className="wheel-spoke spoke-2"></div>
                </div>
              </div>
              <div className="steering-value">{steeringAngle}°</div>
            </div>

            {/* Accelerometer Toggle */}
            <button 
              className={`accel-toggle ${accelerometerEnabled ? 'enabled' : ''}`}
              onClick={accelerometerEnabled ? () => setAccelerometerEnabled(false) : enableAccelerometer}
            >
              <span className="accel-icon">📱</span>
              {accelerometerEnabled ? 'TILT STEERING ON' : 'ENABLE TILT STEERING'}
            </button>

            {/* Speed Display */}
            <div className="speed-display">
              <div className="speed-bar-container">
                <div 
                  className={`speed-bar ${motorSpeed < 0 ? 'reverse' : 'forward'}`}
                  style={{ 
                    width: `${Math.abs(motorSpeed)}%`,
                    left: motorSpeed < 0 ? `${50 - Math.abs(motorSpeed) / 2}%` : '50%'
                  }}
                ></div>
                <div className="speed-center-line"></div>
              </div>
              <div className="speed-value">
                {motorSpeed > 0 ? '+' : ''}{motorSpeed}%
                <span className="speed-label">{motorSpeed < 0 ? 'REV' : motorSpeed > 0 ? 'FWD' : 'STOP'}</span>
              </div>
            </div>

            {/* Emergency Stop */}
            <button className="emergency-btn" onClick={emergencyStop}>
              STOP
            </button>

            {/* Accelerometer Data (Debug) */}
            {accelerometerEnabled && (
              <div className="accel-data">
                X: {accelerometerData.x}° | Y: {accelerometerData.y}°
              </div>
            )}
          </div>

          {/* Right Panel - Throttle */}
          <div className="control-panel right-panel">
            <button
              className={`pedal-btn throttle-btn ${motorSpeed > 0 ? 'active' : ''}`}
              onTouchStart={startThrottle}
              onTouchEnd={stopThrottle}
              onMouseDown={startThrottle}
              onMouseUp={stopThrottle}
              onMouseLeave={stopThrottle}
            >
              <span className="pedal-icon">⚡</span>
              <span className="pedal-label">GAS</span>
            </button>
          </div>
        </div>
      </div>
  )
}

export default App
