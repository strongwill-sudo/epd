let bleDevice, gattServer;
let epdService, epdCharacteristic;
let startTime, msgIndex, appVersion;
let canvas, ctx, textDecoder;
let height;
const EpdCmd = {
  SET_PINS:  0x00,
  INIT:      0x01,
  CLEAR:     0x02,
  SEND_CMD:  0x03,
  SEND_DATA: 0x04,
  REFRESH:   0x05,
  SLEEP:     0x06,

  SET_TIME:  0x20,

  WRITE_IMG: 0x30, // v1.6
 WRITE_PART:   0x31,
  SET_CONFIG: 0x90,
  SYS_RESET:  0x91,
  SYS_SLEEP:  0x92,
  CFG_ERASE:  0x99,
SET_IMG_SIZE:0x33,
IMG_POS:0x38,
DJS_DATE:0x31,

};

const canvasSizes = [


  { name: '2.0_144_20', width: 144, height: 20 },
  { name: '1.70_144_170', width: 144, height: 170 },
  { name: '2.13_212_104', width: 212, height: 104 },
  { name: '2.13_250_122', width: 250, height: 122 },
  { name: '2.66_296_152', width: 296, height: 152 },
  { name: '2.9_296_128', width: 296, height: 128 },
  { name: '2.9_384_168', width: 384, height: 168 },
  { name: '3.5_384_184', width: 384, height: 184 },
  { name: '3.7_416_240', width: 416, height: 240 },
  { name: '3.97_800_480', width: 800, height: 480 },
  { name: '4.2_400_300', width: 400, height: 300 },
  { name: '5.79_792_272', width: 792, height: 272 },
  { name: '7.5_800_480', width: 800, height: 480 },
  { name: '10.2_960_640', width: 960, height: 640 },
  { name: '10.85_1360_480', width: 1360, height: 480 },
  { name: '11.6_960_640', width: 960, height: 640 },
  { name: '4E_600_400', width: 600, height: 400 },
  { name: '7.3E6', width: 480, height: 800 },
 { name: '0.5_128_100', width: 128, height: 100 }
];

function hex2bytes(hex) {
  for (var bytes = [], c = 0; c < hex.length; c += 2)
    bytes.push(parseInt(hex.substr(c, 2), 16));
  return new Uint8Array(bytes);
}

function bytes2hex(data) {
  return new Uint8Array(data).reduce(
    function (memo, i) {
      return memo + ("0" + i.toString(16)).slice(-2);
    }, "");
}

function intToHex(intIn) {
  let stringOut = ("0000" + intIn.toString(16)).substr(-4)
  return stringOut.substring(2, 4) + stringOut.substring(0, 2);
}

function resetVariables() {
  gattServer = null;
  epdService = null;
  epdCharacteristic = null;
  msgIndex = 0;
  document.getElementById("log").value = '';
}

async function write(cmd, data, withResponse = true) {
  if (!epdCharacteristic) {
    addLog("服务不可用，请检查蓝牙连接");
    return false;
  }
  let payload = [cmd];
  if (data) {
    if (typeof data == 'string') data = hex2bytes(data);
    if (data instanceof Uint8Array) data = Array.from(data);
    payload.push(...data)
  }
  addLog(bytes2hex(payload), '⇑');
  try {
    if (withResponse)
      await epdCharacteristic.writeValueWithResponse(Uint8Array.from(payload));
    else
      await epdCharacteristic.writeValueWithoutResponse(Uint8Array.from(payload));
  } catch (e) {
    console.error(e);
    if (e.message) addLog("write: " + e.message);
    return false;
  }
  return true;
}

async function writeImage(data, step = 'bw') {
  const chunkSize = document.getElementById('mtusize').value - 2;
  const interleavedCount = document.getElementById('interleavedcount').value;
  const count = Math.round(data.length / chunkSize);
  let chunkIdx = 0;
  let noReplyCount = interleavedCount;

  for (let i = 0; i < data.length; i += chunkSize) {
    let currentTime = (new Date().getTime() - startTime) / 1000.0;
    setStatus(`${step == 'bw' ? '黑白' : '颜色'}块: ${chunkIdx + 1}/${count + 1}, 总用时: ${currentTime}s`);
    const payload = [
      (step == 'bw' ? 0x0F : 0x00) | (i == 0 ? 0x00 : 0xF0),
      ...data.slice(i, i + chunkSize),
    ];
    if (noReplyCount > 0) {
      await write(EpdCmd.WRITE_IMG, payload, false);
      noReplyCount--;
    } else {
      await write(EpdCmd.WRITE_IMG, payload, true);
      noReplyCount = interleavedCount;
    }
    chunkIdx++;
  }
}

async function setDriver() {
  await write(EpdCmd.SET_PINS, document.getElementById("epdpins").value);
  await write(EpdCmd.INIT, document.getElementById("epddriver").value);
}

async function syncTime(mode) {
  const timestamp = new Date().getTime() / 1000;
  const data = new Uint8Array([
    (timestamp >> 24) & 0xFF,
    (timestamp >> 16) & 0xFF,
    (timestamp >> 8) & 0xFF,
    timestamp & 0xFF,
    -(new Date().getTimezoneOffset() / 60),
    mode
  ]);
  if (await write(EpdCmd.SET_TIME, data)) {
    addLog("时间已同步！");
    addLog("屏幕刷新完成前请不要操作。");
  }
}

async function clearScreen() {
  if (confirm('确认清除屏幕内容?')) {
    await write(EpdCmd.CLEAR);
    addLog("清屏指令已发送！");
    addLog("屏幕刷新完成前请不要操作。");
  }
}

async function sendcmd() {
  const cmdTXT = document.getElementById('cmdTXT').value;
  if (cmdTXT == '') return;
  const bytes = hex2bytes(cmdTXT);
  await write(bytes[0], bytes.length > 1 ? bytes.slice(1) : null);
}

async function sendimg() {
  const canvasSize = document.getElementById('canvasSize').value;
  const ditherMode = document.getElementById('ditherMode').value;
  const epdDriverSelect = document.getElementById('epddriver');
  const selectedOption = epdDriverSelect.options[epdDriverSelect.selectedIndex];


 

const heightH=(height>>8) & 0xff;
const  heightL=height &0xff;

 //const  imgsize=new Uint8Array([startX,startY,width,height]);
//await write(EpdCmd.SET_IMG_SIZE,imgsize);
const imgpos=new Uint8Array([heightH,heightL]);
await write(EpdCmd.IMG_POS,imgpos);
  startTime = new Date().getTime();
  const status = document.getElementById("status");
  status.parentElement.style.display = "block";

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const processedData = processImageData(imageData);

  updateButtonStatus(true);

  if (ditherMode === 'fourColor') {
    await writeImage(processedData, 'color');
  } else if (ditherMode === 'threeColor') {
    const halfLength = Math.floor(processedData.length / 2);
    await writeImage(processedData.slice(0, halfLength), 'bw');
    await writeImage(processedData.slice(halfLength), 'red');
  } else if (ditherMode === 'blackWhiteColor') {
    await writeImage(processedData, 'bw');
  } else {
    addLog("当前固件不支持此颜色模式。");
    updateButtonStatus();
    return;
  }

  await write(EpdCmd.REFRESH);
  updateButtonStatus();

  const sendTime = (new Date().getTime() - startTime) / 1000.0;
  addLog(`发送完成！耗时: ${sendTime}s`);
  setStatus(`发送完成！耗时: ${sendTime}s`);
  addLog("屏幕刷新完成前请不要操作。");
  setTimeout(() => {
    status.parentElement.style.display = "none";
  }, 5000);
}
async function sendareaimg() {
  const canvasSize = document.getElementById('canvasSize').value;
  const ditherMode = document.getElementById('ditherMode').value;
  const epdDriverSelect = document.getElementById('epddriver');
  const selectedOption = epdDriverSelect.options[epdDriverSelect.selectedIndex];
  const startX = parseInt(document.getElementById('startX').value);
    const startY = parseInt(document.getElementById('startY').value);
    const width = parseInt(document.getElementById('width').value);
    const height = parseInt(document.getElementById('height').value);


 
    if (!bluetoothDevice || !bluetoothDevice.gatt.connected) {
      log("蓝牙未连接");
      return;
  }
  
  try {
      // 检查参数是否合法
      if (startX < 0 || startY < 0 || width <= 0 || height <= 0) {
          log("区域参数不合法");
          return;
      }
      
      // 获取canvas中的整个图像数据
      const canvas = document.getElementById('canvas');
      const ctx = canvas.getContext('2d');
      
     
          imageData = ctx.getImageData(0, 0, width, height);
      
      
      const data = imageData.data;
      
      // 根据不同的图像类型处理数据
      let imageBytes = [];
      if (type === 0) { // 黑白
          // 处理黑白图像数据，转换为1位表示
          for (let i = 0; i < data.length; i += 4) {
              // 计算灰度值
              const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
              // 二值化处理，阈值设为128
              const bit = gray < 128 ? 1 : 0;
              imageBytes.push(bit);
          }
      } else if (type === 1 || type === 2 || type === 3) { // 黑白红/黄/橙
          // 处理彩色图像数据
          for (let i = 0; i < data.length; i += 4) {
              const r = data[i];
              const g = data[i + 1];
              const b = data[i + 2];
              
              // 检测红色/黄色/橙色
              let colorBit = 0; // 默认黑色
              if (type === 1) { // 红色
                  if (r > 200 && g < 100 && b < 100) {
                      colorBit = 1; // 红色
                  }
              } else if (type === 2) { // 黄色
                  if (r > 200 && g > 200 && b < 100) {
                      colorBit = 1; // 黄色
                  }
              } else if (type === 3) { // 橙色
                  if (r > 220 && g > 120 && g < 200 && b < 100) {
                      colorBit = 1; // 橙色
                  }
              }
              
              // 计算灰度值
              const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
              // 二值化处理，阈值设为128
              const blackBit = gray < 128 ? 1 : 0;
              
              // 合并黑白和彩色信息
              // 00: 白色, 01: 彩色, 10: 黑色, 11: 保留
              const combined = (blackBit << 1) | colorBit;
              imageBytes.push(combined);
          }
      } else {
          log("不支持的图像类型");
          return;
      }
      
      // 将图像数据转换为字节数组
      let bytes = [];
      if (type === 0) { // 黑白图像，每8位合并为一个字节
          for (let i = 0; i < imageBytes.length; i += 8) {
              let byte = 0;
              for (let j = 0; j < 8; j++) {
                  if (i + j < imageBytes.length) {
                      byte |= imageBytes[i + j] << (7 - j);
                  }
              }
              bytes.push(byte);
          }
      } else { // 彩色图像，每4位合并为一个字节
          for (let i = 0; i < imageBytes.length; i += 2) {
              let byte = 0;
              if (i < imageBytes.length) {
                  byte |= (imageBytes[i] & 0x03) << 4;
              }
              if (i + 1 < imageBytes.length) {
                  byte |= imageBytes[i + 1] & 0x03;
              }
              bytes.push(byte);
          }
      }
      
      // 发送区域图像命令
      const dataLength = type === 0 
      ? Math.ceil(width * height / 8)    // 黑白图像每8位像素占1字节
      : Math.ceil(width * height / 2);   // 彩色图像每2像素占1字节
    
    // 发送区域图像命令，包含数据长度信息
    await write([
      EpdCmd.WRITE_PART, 
      startX & 0xFF, (startX >> 8) & 0xFF,       // X坐标（低字节在前，高字节在后）
      startY & 0xFF, (startY >> 8) & 0xFF,       // Y坐标
      width & 0xFF, (width >> 8) & 0xFF, // 宽度
      height & 0xFF, (height >> 8) & 0xFF, // 高度
      type & 0xFF,                      // 图像类型
      dataLength & 0xFF, (dataLength >> 8) & 0xFF, // 数据长度（低字节在前）
    ]);
      
      // 分块发送图像数据，每块512字节
      const chunkSize = 256;
      for (let i = 0; i < bytes.length; i += chunkSize) {
          const chunk = bytes.slice(i, i + chunkSize);
          await write(chunk);
      }
      
      log("区域图像发送完成");
  } catch (error) {
      log("发送区域图像时出错: " + error);
  }
}

  


  

function downloadDataArray() {
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const processedData = processImageData(imageData);
  const mode = document.getElementById('ditherMode').value;

  if (mode === 'sixColor' && processedData.length !== canvas.width * canvas.height) {
    console.log(`错误：预期${canvas.width * canvas.height}字节，但得到${processedData.length}字节`);
    addLog('数组大小不匹配。请检查图像尺寸和模式。');
    return;
  }

  const dataLines = [];
  for (let i = 0; i < processedData.length; i++) {
    const hexValue = (processedData[i] & 0xff).toString(16).padStart(2, '0');
    dataLines.push(`0x${hexValue}`);
  }

  const formattedData = [];
  for (let i = 0; i < dataLines.length; i += 16) {
    formattedData.push(dataLines.slice(i, i + 16).join(', '));
  }

  const colorModeValue = mode === 'sixColor' ? 0 : mode === 'fourColor' ? 1 : mode === 'blackWhiteColor' ? 2 : 3;
  const arrayContent = [
    'const uint8_t imageData[] PROGMEM = {',
    formattedData.join(',\n'),
    '};',
    `const uint16_t imageWidth = ${canvas.width};`,
    `const uint16_t imageHeight = ${canvas.height};`,
    `const uint8_t colorMode = ${colorModeValue};`
  ].join('\n');

  const blob = new Blob([arrayContent], { type: 'text/plain' });
  const link = document.createElement('a');
  link.download = 'imagedata.h';
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
}

function updateButtonStatus(forceDisabled = false) {
  const connected = gattServer != null && gattServer.connected;
  const status = forceDisabled ? 'disabled' : (connected ? null : 'disabled');
  document.getElementById("reconnectbutton").disabled = (gattServer == null || gattServer.connected) ? 'disabled' : null;
  document.getElementById("sendcmdbutton").disabled = status;
  document.getElementById("calendarmodebutton").disabled = status;
  document.getElementById("clockmodebutton").disabled = status;
  document.getElementById("clearscreenbutton").disabled = status;
  document.getElementById("sendimgbutton").disabled = status;
  document.getElementById("setDriverbutton").disabled = status;
}

function disconnect() {
  updateButtonStatus();
  resetVariables();
  addLog('已断开连接.');
  document.getElementById("connectbutton").innerHTML = '连接';
}

async function preConnect() {
  if (gattServer != null && gattServer.connected) {
    if (bleDevice != null && bleDevice.gatt.connected) {
      bleDevice.gatt.disconnect();
    }
  }
  else {
    resetVariables();
    try {
      bleDevice = await navigator.bluetooth.requestDevice({
        optionalServices: ['62750001-d828-918d-fb46-b6c11c675aec'],
        acceptAllDevices: true
      });
    } catch (e) {
      console.error(e);
      if (e.message) addLog("requestDevice: " + e.message);
      addLog("请检查蓝牙是否已开启，且使用的浏览器支持蓝牙！建议使用以下浏览器：");
      addLog("• 电脑: Chrome/Edge");
      addLog("• Android: Chrome/Edge");
      addLog("• iOS: Bluefy 浏览器");
      return;
    }

    await bleDevice.addEventListener('gattserverdisconnected', disconnect);
    setTimeout(async function () { await connect(); }, 300);
  }
}

async function reConnect() {
  if (bleDevice != null && bleDevice.gatt.connected)
    bleDevice.gatt.disconnect();
  resetVariables();
  addLog("正在重连");
  setTimeout(async function () { await connect(); }, 300);
}

function handleNotify(value, idx) {
  const data = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (idx == 0) {
    addLog(`收到配置：${bytes2hex(data)}`);
    const epdpins = document.getElementById("epdpins");
    const epddriver = document.getElementById("epddriver");
    epdpins.value = bytes2hex(data.slice(0, 7));
    if (data.length > 10) epdpins.value += bytes2hex(data.slice(10, 11));
    epddriver.value = bytes2hex(data.slice(7, 8));
    updateDitcherOptions();
  } else {
    if (textDecoder == null) textDecoder = new TextDecoder();
    const msg = textDecoder.decode(data);
    addLog(msg, '⇓');
    if (msg.startsWith('mtu=') && msg.length > 4) {
      const mtuSize = parseInt(msg.substring(4));
      document.getElementById('mtusize').value = mtuSize;
      addLog(`MTU 已更新为: ${mtuSize}`);
    } else if (msg.startsWith('t=') && msg.length > 2) {
      const t = parseInt(msg.substring(2)) + new Date().getTimezoneOffset() * 60;
      addLog(`远端时间: ${new Date(t * 1000).toLocaleString()}`);
      addLog(`本地时间: ${new Date().toLocaleString()}`);
    }
  }
}

async function connect() {
  if (bleDevice == null || epdCharacteristic != null) return;

  try {
    addLog("正在连接: " + bleDevice.name);
    gattServer = await bleDevice.gatt.connect();
    addLog('  找到 GATT Server');
    epdService = await gattServer.getPrimaryService('62750001-d828-918d-fb46-b6c11c675aec');
    addLog('  找到 EPD Service');
    epdCharacteristic = await epdService.getCharacteristic('62750002-d828-918d-fb46-b6c11c675aec');
    addLog('  找到 Characteristic');
  } catch (e) {
    console.error(e);
    if (e.message) addLog("connect: " + e.message);
    disconnect();
    return;
  }

  try {
    const versionCharacteristic = await epdService.getCharacteristic('62750003-d828-918d-fb46-b6c11c675aec');
    const versionData = await versionCharacteristic.readValue();
    appVersion = versionData.getUint8(0);
    addLog(`固件版本: 0x${appVersion.toString(16)}`);
  } catch (e) {
    console.error(e);
    appVersion = 0x15;
  }

  if (appVersion < 0x16) {
    const oldURL = "https://tsl0922.github.io/EPD-nRF5/v1.5";
    alert("!!!注意!!!\n当前固件版本过低，可能无法正常使用部分功能，建议升级到最新版本。");
    if (confirm('是否访问旧版本上位机？')) location.href = oldURL;
    setTimeout(() => {
      addLog(`如遇到问题，可访问旧版本上位机: ${oldURL}`);
    }, 500);
  }

  try {
    await epdCharacteristic.startNotifications();
    epdCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
      handleNotify(event.target.value, msgIndex++);
    });
  } catch (e) {
    console.error(e);
    if (e.message) addLog("startNotifications: " + e.message);
  }

  await write(EpdCmd.INIT);

  document.getElementById("connectbutton").innerHTML = '断开';
  updateButtonStatus();
}

function setStatus(statusText) {
  document.getElementById("status").innerHTML = statusText;
}

function addLog(logTXT, action = '') {
  const log = document.getElementById("log");
  const now = new Date();
  const time = String(now.getHours()).padStart(2, '0') + ":" +
    String(now.getMinutes()).padStart(2, '0') + ":" +
    String(now.getSeconds()).padStart(2, '0') + " ";

  const logEntry = document.createElement('div');
  const timeSpan = document.createElement('span');
  timeSpan.className = 'time';
  timeSpan.textContent = time;
  logEntry.appendChild(timeSpan);

  if (action !== '') {
    const actionSpan = document.createElement('span');
    actionSpan.className = 'action';
    actionSpan.innerHTML = action;
    logEntry.appendChild(actionSpan);
  }
  logEntry.appendChild(document.createTextNode(logTXT));

  log.appendChild(logEntry);
  log.scrollTop = log.scrollHeight;

  while (log.childNodes.length > 20) {
    log.removeChild(log.firstChild);
  }
}

function clearLog() {
  document.getElementById("log").innerHTML = '';
}

function updateCanvasSize() {
  const selectedSizeName = document.getElementById('canvasSize').value;
  const selectedSize = canvasSizes.find(size => size.name === selectedSizeName);

  canvas.width = selectedSize.width;
  canvas.height = selectedSize.height;
  height=selectedSize.height;

  updateImage(false);
}


function updateCanvasSizeFree() {

  

  canvas.width = parseInt(document.getElementById('width').value);
  canvas.height = parseInt(document.getElementById('height').value);

  updateImage(false);
}
function updateDitcherOptions() {
  const epdDriverSelect = document.getElementById('epddriver');
  const selectedOption = epdDriverSelect.options[epdDriverSelect.selectedIndex];
  const colorMode = selectedOption.getAttribute('data-color');
  const canvasSize = selectedOption.getAttribute('data-size');

  if (colorMode) document.getElementById('ditherMode').value = colorMode;
  if (canvasSize) document.getElementById('canvasSize').value = canvasSize;

  updateCanvasSize(); // always update image
}

function updateImage(clear = false) {
  const image_file = document.getElementById('image_file');
  if (image_file.files.length == 0) return;

  if (clear) clearCanvas();

  const file = image_file.files[0];
  let image = new Image();;
  image.src = URL.createObjectURL(file);
  image.onload = function (event) {
    URL.revokeObjectURL(this.src);
    ctx.drawImage(image, 0, 0, image.width, image.height, 0, 0, canvas.width, canvas.height);

    // Redraw text and lines
    redrawTextElements();
    redrawLineSegments();

    convertDithering()
  }
}

function clearCanvas() {
  if (confirm('清除画布已有内容?')) {
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    textElements = []; // Clear stored text positions
    lineSegments = []; // Clear stored line segments
    return true;
  }
  return false;
}

function convertDithering() {
  const contrast = parseFloat(document.getElementById('contrast').value);
  const currentImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const imageData = new ImageData(
    new Uint8ClampedArray(currentImageData.data),
    currentImageData.width,
    currentImageData.height
  );

  adjustContrast(imageData, contrast);

  const mode = document.getElementById('ditherMode').value;
  const processedData = processImageData(ditherImage(imageData));
  const finalImageData = decodeProcessedData(processedData, canvas.width, canvas.height, mode);
  ctx.putImageData(finalImageData, 0, 0);
}

function checkDebugMode() {
  const link = document.getElementById('debug-toggle');
  const urlParams = new URLSearchParams(window.location.search);
  const debugMode = urlParams.get('debug');

  if (debugMode === 'true') {
    document.body.classList.add('debug-mode');
    link.innerHTML = '正常模式';
    link.setAttribute('href', window.location.pathname);
    addLog("注意：开发模式功能已开启！不懂请不要随意修改，否则后果自负！");
  } else {
    document.body.classList.remove('debug-mode');
    link.innerHTML = '开发模式';
    link.setAttribute('href', window.location.pathname + '?debug=true');
  }
}

document.body.onload = () => {
  textDecoder = null;
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext("2d");

  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  initPaintTools();
  updateButtonStatus();
  checkDebugMode();
}
async function sendDateTimeToLowerMachine() {
  const targetDateInput = document.getElementById('targetDate');
 
  // 验证输入
  if (!targetDateInput.value) {
      alert('请选择目标日期');
      return;
  }
  
  const fullDateTime = `${targetDateInput.value} 23:59:59`;
  const targetDateTime = new Date(fullDateTime);
  const dyear=targetDateTime.getFullYear();
  const djsyearh=(dyear>>8)& 0xff;
  const djsyearl=dyear & 0xff;
  const djsm=targetDateTime.getMonth()& 0xff;
  const djsd=targetDateTime.getDate()& 0xff;
 
  const djsdate = [djsyearh,djsyearl,djsm,djsd];
      
  await write(EpdCmd.DJS_DATE,djsdate);

  await write(EpdCmd.REFRESH);
}
