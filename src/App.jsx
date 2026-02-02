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
  const [motorSpeed, setMotorSpeed] = useState(0) // 0 to 100
  const [accelerometerEnabled, setAccelerometerEnabled] = useState(false)
  
  // Refs for BLE
  const deviceRef = useRef(null)
  const servoCharRef = useRef(null)
  const motorCharRef = useRef(null)
  const throttleIntervalRef = useRef(null)

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
        const value = new Uint8Array([Math.round(speed)])
        await motorCharRef.current.writeValue(value)
      } catch (error) {
        console.error('Motor write error:', error)
      }
    }
  }, [isConnected])

  // Handle steering slider change
  const handleSteeringChange = (e) => {
    const angle = parseInt(e.target.value)
    setSteeringAngle(angle)
    sendSteeringAngle(angle)
  }

  // Handle accelerometer for steering
  useEffect(() => {
    if (!accelerometerEnabled) return

    const handleOrientation = (event) => {
      // gamma is left-right tilt in landscape (-90 to 90)
      const gamma = event.gamma || 0
      
      // Map gamma (-45 to 45) to servo angle (0 to 180)
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
    // Gradually decrease speed when released
    setMotorSpeed(0)
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
    }
  }, [])

  return (
    <div className="kart-controller">
      {/* Main Controller UI */}
      <div className="controller-layout-simple">
        
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
          
          {/* Tilt Toggle in top bar */}
          <button 
            className={`tilt-toggle ${accelerometerEnabled ? 'enabled' : ''}`}
            onClick={accelerometerEnabled ? () => setAccelerometerEnabled(false) : enableAccelerometer}
          >
            📱 {accelerometerEnabled ? 'TILT ON' : 'TILT'}
          </button>
          
          {isConnected && (
            <button className="disconnect-btn" onClick={disconnectBLE}>
              ✕
            </button>
          )}
          {bleError && (
            <div className="error-toast">{bleError}</div>
          )}
        </div>

        {/* Main Content */}
        <div className="main-content">
          {/* Throttle Button - Large on right side */}
          <div className="throttle-area">
            <button
              className={`throttle-btn-large ${motorSpeed > 0 ? 'active' : ''}`}
              onTouchStart={startThrottle}
              onTouchEnd={stopThrottle}
              onMouseDown={startThrottle}
              onMouseUp={stopThrottle}
              onMouseLeave={stopThrottle}
            >
              <span className="throttle-icon">⚡</span>
              <span className="throttle-label">GAS</span>
              <span className="throttle-value">{motorSpeed}%</span>
            </button>
          </div>

          {/* Center Info */}
          <div className="center-info">
            <div className="steering-wheel-display" style={{ transform: `rotate(${steeringAngle - 90}deg)` }}>
              <div className="wheel-inner">
                <div className="wheel-spoke"></div>
                <div className="wheel-spoke spoke-2"></div>
              </div>
            </div>
            <div className="steering-angle">{steeringAngle}°</div>
          </div>
        </div>

        {/* Steering Slider - Bottom */}
        <div className="steering-slider-container">
          <span className="slider-label left">◀ LEFT</span>
          <div className="slider-wrapper">
            <input
              type="range"
              min="0"
              max="180"
              value={steeringAngle}
              onChange={handleSteeringChange}
              className="steering-slider"
              disabled={accelerometerEnabled}
            />
            <div 
              className="slider-thumb-indicator"
              style={{ left: `${(steeringAngle / 180) * 100}%` }}
            ></div>
          </div>
          <span className="slider-label right">RIGHT ▶</span>
        </div>
        
      </div>
    </div>
  )
}

export default App
