let bleDevice, gattServer;
let epdService, epdCharacteristic;
let startTime, msgIndex, appVersion;
let canvas, ctx, textDecoder;
let height;
let width;
//=====旋转、预览缩放全局变量=====
let viewScale = 1.0;
let viewOffsetX = 0;
let viewOffsetY = 0;
const VIEW_SCALE_STEP = 0.1;
const VIEW_SCALE_MIN = 0.2;
const VIEW_SCALE_MAX = 5.0;
let origLoadedImage = null;
// 仅属于导入图片的变换（只对图片生效，手绘文字完全隔离）
let imgScale = 1.0;
let imgOffsetX = 0;
let imgOffsetY = 0;
const IMG_SCALE_STEP = 0.1;
const IMG_SCALE_MIN = 0.05;
const IMG_SCALE_MAX = 6.0;

// =========新增：图片拖拽变量=========
let isDragImage = false;
let dragStartMouseX = 0;
let dragStartMouseY = 0;
let dragStartOffsetX = 0;
let dragStartOffsetY = 0;

//====双指缩放新增变量====
let touchTwoStartDist = 0;
let touchTwoStartScale = 1.0;
let touchTwoStartOffsetX = 0;
let touchTwoStartOffsetY = 0;

const MAX_SCREEN_WIDTH = 104;
const MAX_SCREEN_HEIGHT = 216;
const EpdCmd = {
  SET_PINS:  0x00,
  INIT:      0x01,
  CLEAR:     0x02,
  SEND_CMD:  0x03,
  SEND_DATA: 0x04,
  //REFRESH:   0x05,
  SLEEP:     0x06,

  SET_TIME:  0xDD,

  WRITE_IMG: 0x98, // v1.6
 WRITE_PART:   0x31,
  SET_CONFIG: 0x90,
  SYS_RESET:  0x91,
  SYS_SLEEP:  0x92,
  CFG_ERASE:  0x99,
 SET_IMG_SIZE:0x33,
 IMG_HEIGHT:0x38,
 IMG_WIDTH: 0x39, // 新增
DJS_DATE:0x31,
TIME_SHOW:0xE1,
VERT_COLOR:0xE3,
SENDCLASS:0x32,
SHOW_COURSE:0x36,
};


  //DA14585 SUOTA协议UUID
  const SUOTA_SERVICE_UUID ="13187b10-eba9-a3ba-044e-83d3217d9a38"; 
  const DEVICE_CHARACTERISTICS = {
    // 关键特征UUID（从参考代码中提取，需与你的设备实际UUID匹配）
    epd: '4b646063-6264-f3a7-8941-e65356ea82fe', // 用于墨水屏控制的主特征
    status:  '4b646063-6264-f3a7-8941-e65356ea82fe', // 状态通知特征
    info: '6c53db25-47a1-45fe-a022-7c92fb334fd4'
  };
  


  

const canvasSizes = [
  { name: '80_18', width: 80, height: 18 },
  { name: '72_22', width: 72, height: 22 },  
 { name: '128_80', width: 128, height: 80 },
 { name: '216_104', width: 216, height: 104 },
 { name: '256_128', width: 256, height: 128 },
 { name: '168_112', width: 168, height: 104 },
 { name: '88_128', width: 88, height: 128 }
];


function delay(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms); // 等待ms毫秒后调用resolve，结束等待
  });
}
function hex2bytes(hex) {
  for (var bytes = [], c = 0; c < hex.length; c += 2)
    bytes.push(parseInt(hex.substr(c, 2), 16));
  return new Uint8Array(bytes);
}

function bytes2hex(data) {
  return new Uint8Array(data).reduce(
    function (memo, i) {
      return memo + ("0" + i.toString(16)).slice(-2) + " "; // 每个字节后加空格
    }, "").trim(); // 移除末尾空格
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
  /*
  if (await write(EpdCmd.SET_TIME, data)) {
    addLog("时间已同步！");
    addLog("屏幕刷新完成前请不要操作。");
  }*/
    await write(EpdCmd.SET_TIME, data);
    const mode_ok=new Uint8Array([mode]);
    await write(EpdCmd.TIME_SHOW, mode_ok);
    addLog("时间已同步！");
    addLog("屏幕刷新完成前请不要操作。");
}
async function vertcolor() {//时间反色
  await write(EpdCmd.VERT_COLOR,[]);
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

async function waitForDeviceAck(timeout) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      // 超时未收到确认，返回false
      addLog(`等待设备确认超时（${timeout}ms）`);
      resolve(false);
    }, timeout);

    // 监听设备发送的蓝牙通知（假设已注册通知回调）
    const ackListener = (data) => {
      // 约定设备的“数据接收确认”为 [0x01, 0x00]，“刷新完成确认”为 [0x02, 0x00]
      if (data[0] === 0x01 && data[1] === 0x00) {
        clearTimeout(timer);
        removeEventListener('deviceAck', ackListener); // 移除监听，避免重复触发
        resolve(true);
      }
      // 若需要监听“刷新完成”，可增加：
      if (data[0] === 0x02 && data[1] === 0x00) {
        clearTimeout(timer);
        removeEventListener('deviceAck', ackListener);
        resolve(true);
      }
    };

    // 注册监听（需结合你的蓝牙库实现，比如Web Bluetooth的characteristicvaluechanged事件）
    addEventListener('deviceAck', ackListener);
  });
}

async function sendimg() {
  
  const canvasSize = document.getElementById('canvasSize').value;
  const ditherMode = document.getElementById('ditherMode').value;
  const epdDriverSelect = document.getElementById('epddriver');
  const selectedOption = epdDriverSelect.options[epdDriverSelect.selectedIndex];
  const heightH=(height>>8) & 0xff;
const  heightL=height &0xff; 
const imgheight=new Uint8Array([heightH,heightL]);
await write(EpdCmd.IMG_HEIGHT,imgheight);
await delay(80);

 // ========= 新增：下发宽度 canvas.width 就是图片真实宽度 88 / 256 =========
  const widthH = (width >> 8) & 0xff;
  const widthL = width & 0xff;
  const imgwidth = new Uint8Array([widthH, widthL]);
  await write(EpdCmd.IMG_WIDTH, imgwidth);
await delay(80);
  
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
  
     //await delay(300);
     //await write(EpdCmd.REFRESH);
        updateButtonStatus();

  const sendTime = (new Date().getTime() - startTime) / 1000.0;
  addLog(`发送完成！耗时: ${sendTime}s`);
  setStatus(`发送完成！耗时: ${sendTime}s`);
  addLog("屏幕刷新完成前请不要操作。");
  setTimeout(() => {
    status.parentElement.style.display = "none";
  }, 5000);
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
        optionalServices: [SUOTA_SERVICE_UUID],
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
  const hexData = bytes2hex(data); // 使用现有bytes2hex函数转换
  if (idx == 0) {
    addLog(`收到配置：${hexData}`, '⇓');
    const epdpins = document.getElementById("epdpins");
    const epddriver = document.getElementById("epddriver");
    epdpins.value = hexData.slice(0, 14); // 前7字节（14个十六进制字符）
    if (data.length > 10) epdpins.value += hexData.slice(20, 22); // 第10字节
    epddriver.value = hexData.slice(14, 16); // 第7字节
    updateDitcherOptions();
  } else {
    // 非配置数据：先尝试判断是否为文本命令（如mtu=、t=），否则显示十六进制
    let isTextCommand = false;
    try {
      // 仅对可能是文本的命令尝试解码（如ASCII格式的mtu=xxx）
      const textDecoder = new TextDecoder('ascii');
      const msg = textDecoder.decode(data);
      // 检查是否是已知的文本命令
      if (msg.startsWith('mtu=') || msg.startsWith('t=')) {
        addLog(msg, '⇓'); // 文本命令正常显示
        isTextCommand = true;
        // 原有文本命令处理逻辑保留
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
    } catch (e) {
      // 解码失败，说明不是文本数据，忽略即可
    }
    
    // 非文本命令：显示十六进制数据（解决乱码）
    if (!isTextCommand) {
      addLog(`收到数据：${hexData}`, '⇓');
    }
  }
}

async function connect() {
  if (bleDevice == null || epdCharacteristic != null) return;

  try {
    addLog("正在连接: " + bleDevice.name);
    gattServer = await bleDevice.gatt.connect();
    addLog('  找到 GATT Server');

    // 1. 获取SUOTA服务（服务UUID正确）
    epdService = await gattServer.getPrimaryService(SUOTA_SERVICE_UUID);
    addLog(`  找到 SUOTA Service (UUID: ${SUOTA_SERVICE_UUID})`);

    // 2. 枚举所有特征，确认设备支持的特征UUID（关键步骤）
    const allCharacteristics = await epdService.getCharacteristics();
    addLog(`  服务下找到 ${allCharacteristics.length} 个特征`);
    allCharacteristics.forEach((char, index) => {
      addLog(`  特征 ${index + 1}: UUID=${char.uuid}`);
    });

    // 3. 匹配墨水屏控制特征（使用预定义的特征UUID）
    epdCharacteristic = await epdService.getCharacteristic(DEVICE_CHARACTERISTICS.epd);
    addLog(`  找到 EPD 特征 (UUID: ${DEVICE_CHARACTERISTICS.epd})`);

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
  
 // 启用特征通知（使用状态特征UUID）
 try {
  const statusCharacteristic = await epdService.getCharacteristic(DEVICE_CHARACTERISTICS.status);
  await statusCharacteristic.startNotifications();
  statusCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
    handleNotify(event.target.value, msgIndex++);
  });
  addLog("已启用状态通知");
} catch (e) {
  console.error(e);
  addLog("启用通知失败: " + e.message);
}

await write(EpdCmd.INIT);
document.getElementById("connectbutton").innerHTML = '断开';
updateButtonStatus();
  
  
/*
  try {
    await epdCharacteristic.startNotifications();
    epdCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
      handleNotify(event.target.value, msgIndex++);
    });
  } catch (e) {
    console.error(e);
    if (e.message) addLog("startNotifications: " + e.message);
  }
*/
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

  while (log.childNodes.length > 500) {
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
  width = selectedSize.width; // ✅ 同步给全局width

  updateImage(false);
}


function updateCanvasSizeFree() {

  

  canvas.width = parseInt(document.getElementById('width').value);
  canvas.height = parseInt(document.getElementById('height').value);
// 补上这两行
  width = canvas.width;
  height = canvas.height;
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
    origLoadedImage = image; //保存原图给旋转图像按钮
    //新图片载入，重置图片缩放偏移
    imgScale = 1.0;
    imgOffsetX = 0;
    imgOffsetY = 0;
    document.getElementById('scaleInfo').innerText = "100%";

    redrawImageLayer();
    convertDithering();
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

  canvas.addEventListener('wheel', function(e) {
    if(!origLoadedImage) return; //没有加载图片，滚轮直接忽略
    e.preventDefault();

    if(e.deltaY < 0){
        imgScale += IMG_SCALE_STEP;
    }else{
        imgScale -= IMG_SCALE_STEP;
    }
    imgScale = Math.max(IMG_SCALE_MIN, Math.min(IMG_SCALE_MAX, imgScale));

    // 更新界面显示缩放百分比（图片图层的scale）
    const scaleInfoDom = document.getElementById('scaleInfo');
    if(scaleInfoDom) scaleInfoDom.innerText = Math.round(imgScale*100)+"%";

    redrawImageLayer(); //重绘：手绘文字不动，图片应用新scale/offset
});
// ==========新增图片拖拽 mousedown ==========
    canvas.addEventListener('mousedown', function(e){
        // 条件：必须有图片，并且**当前不是画笔、橡皮擦、文字工具**才允许拖拽图片
        if(!origLoadedImage) return;
        if(currentTool === "brush" || currentTool === "eraser" || currentTool === "text"){
            return; //画笔模式，交给paint.js绘图，不启动拖拽
        }
        e.preventDefault();
        isDragImage = true;
        const rect = canvas.getBoundingClientRect();
        dragStartMouseX = e.clientX - rect.left;
        dragStartMouseY = e.clientY - rect.top;
        // 保存拖拽开始瞬间图片偏移
        dragStartOffsetX = imgOffsetX;
        dragStartOffsetY = imgOffsetY;
    });

    // ==========鼠标移动，拖拽图片==========
    canvas.addEventListener('mousemove', function(e){
        if(!isDragImage || !origLoadedImage) return;
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        //计算鼠标移动差值，叠加到图片offset
        imgOffsetX = dragStartOffsetX + (mx - dragStartMouseX);
        imgOffsetY = dragStartOffsetY + (my - dragStartMouseY);
        redrawImageLayer();
    });

    // =========鼠标抬起 / 鼠标离开，结束拖拽=========
    function endImageDrag(){
        if(isDragImage){
            isDragImage = false;
        }
    }
    canvas.addEventListener('mouseup', endImageDrag);
    canvas.addEventListener('mouseleave', endImageDrag);
 // =========新增：双指捏合缩放图片=========
    canvas
.addEventListener('touchstart',function(e){
        if(!origLoadedImage) return;
        // 当前是画笔/橡皮擦/文字工具，不做图片缩放拖拽
        if(currentTool === "brush" || currentTool === "eraser" || currentTool === "text") return;

        if(e.touches.length === 2){
            e
.preventDefault();
            // 计算两指之间距离
            const t1 = e.touches[0];
            const t2 = e.touches[1];
            const dx = t2.clientX - t1.clientX;
            const dy = t2.clientY - t1.clientY;
            touchTwoStartDist 
= Math.sqrt(dx*dx + dy*dy);
            touchTwoStartScale 
= imgScale;
            touchTwoStartOffsetX 
= imgOffsetX;
            touchTwoStartOffsetY 
= imgOffsetY;
        }
    });

    canvas
.addEventListener('touchmove',function(e){
        if(!origLoadedImage) return;
        if(currentTool === "brush" || currentTool === "eraser" || currentTool === "text") return;
        if(e.touches.length === 2){
            e
.preventDefault();
            const t1 = e.touches[0];
            const t2 = e.touches[1];
            const dx = t2.clientX - t1.clientX;
            const dy = t2.clientY - t1.clientY;
            const dist = Math.sqrt(dx*dx + dy*dy);
            // 计算缩放倍率
            const scaleRatio = dist / touchTwoStartDist;
            imgScale 
= touchTwoStartScale * scaleRatio;
            // 限制最大最小缩放，和滚轮保持一致
            imgScale 
= Math.max(IMG_SCALE_MIN, Math.min(IMG_SCALE_MAX, imgScale));
            // 更新界面百分比
            const scaleInfoDom = document.getElementById('scaleInfo');
            if(scaleInfoDom) scaleInfoDom.innerText = Math.round(imgScale*100)+"%";
            redrawImageLayer();
        }
    });

    canvas
.addEventListener('touchend',function(){
        touchTwoStartDist 
= 0;
    });


}
async function showcourse()
{
  await write(EpdCmd.SHOW_COURSE);
}
async function sendDateTimeToLowerMachine(mode) {
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
 
  const djsdate = [djsyearh,djsyearl,djsm,djsd,mode];
      
  await write(EpdCmd.DJS_DATE,djsdate);

  await write(EpdCmd.REFRESH);
}

let isAlertShowing = false; // 防止重复弹窗的标记

        function checkArea() {
            // 1. 处理输入值（避免非数字导致报错）
            const x = parseInt(document.getElementById('areaX').value) || 0;
            const y = parseInt(document.getElementById('areaY').value) || 0;
            const w = parseInt(document.getElementById('areaW').value) || 1;
            const h = parseInt(document.getElementById('areaH').value) || 1;

            // 2. 防止重复弹窗（当前有弹窗时，不触发新弹窗）
            if (isAlertShowing) return;

            // 3. 校验并弹出对应提示
            // 情况1：横坐标越界（X+宽 > 104）
            if (x + w > 104) {
                isAlertShowing = true; // 标记弹窗正在显示
                alert(`横坐标越界！X(${x}) + 宽度(${w}) = ${x + w}，超过屏幕最大宽度104`);
                isAlertShowing = false; // 弹窗关闭后，解除标记
                return;
            }

            // 情况2：纵坐标越界（Y+高 > 212）
            if (y + h > 212) {
                isAlertShowing = true;
                alert(`纵坐标越界！Y(${y}) + 高度(${h}) = ${y + h}，超过屏幕最大高度212`);
                isAlertShowing = false;
                return;
            }
            canvas.width = parseInt(document.getElementById('areaW').value);
            canvas.height = parseInt(document.getElementById('areaH').value);
        
            updateImage(false);

        }

    async function sendclass() {
    const input = document.getElementById('cmdCLASS').value.trim();
    
    if (!input) {
        alert('请输入5天课程数据');
        return;
    }

    const dayCodes = input.split(',');
    if (dayCodes.length !== 5) {
        alert("输入格式错误！请输入5天课程数据，用逗号分隔（如：12365ac76,5466dd123,12365ac70,12365ac76,12365ac76）");
        return;
    }

    const payload = [];
    for (let i = 0; i < 5; i++) {
        const code = dayCodes[i];
        if (code.length !== 9) {
            alert(`第${i+1}天数据错误！`);
            return;
        }
        for (let char of code) payload.push(parseInt(char, 16));
    }

    await write(EpdCmd.SENDCLASS, payload);
    await write(EpdCmd.REFRESH);
}
// 画布黑白反色函数
function invertCanvas() {
    if (!canvas || !ctx) return;
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        // 接近白色就当成255，其余当成0
        const isWhite = r > 127;
        const val = isWhite ? 0 : 255;
        data[i] = val;
        data[i+1] = val;
        data[i+2] = val;
    }
    ctx.putImageData(imgData, 0, 0);
    addLog("画布已黑白反色（二值翻转，无二次抖动）");
}

/**
 * 重置预览缩放（只重置视图，不改变画布像素）
 */
function resetView() {
    viewScale = 1;
    viewOffsetX = 0;
    viewOffsetY = 0;
    const scaleInfoDom = document.getElementById('scaleInfo');
    if(scaleInfoDom) scaleInfoDom.innerText = "100%";
    renderPreview(); // ←====新增
}

/**
 * rotateCanvas：像素级旋转整个画布90°，交换宽高，手绘+文字+图片全部旋转
 */
function rotateCanvas() {
    const temp = document.createElement('canvas');
    const w = canvas.width, h = canvas.height;
    temp.width = h;
    temp.height = w;
    const tctx = temp.getContext('2d');
    tctx.translate(h / 2, w / 2);
    tctx.rotate(Math.PI / 2);
    tctx.drawImage(canvas, -w / 2, -h / 2);

    canvas.width = h;
    canvas.height = w;
    width = h;
    height = w;

    ctx.drawImage(temp, 0, 0);
    redrawTextElements();
    redrawLineSegments();
    addLog("画布整体已旋转90°，宽高已交换");
    renderPreview(); // ←====新增
}

function rotateImageOnly() {
    if (!origLoadedImage) {
        alert("请先上传图片！");
        return;
    }
    const w = origLoadedImage.width, h = origLoadedImage.height;
    const tempImg = document.createElement('canvas');
    tempImg.width = h;
    tempImg.height = w;
    const tctx = tempImg.getContext('2d');
    tctx.translate(h / 2, w / 2);
    tctx.rotate(Math.PI / 2);
    tctx.drawImage(origLoadedImage, -w / 2, -h / 2);

    origLoadedImage = tempImg;
    addLog("导入图像旋转+90°（仅图片）");
    redrawImageLayer();
}

/**
 * 预览渲染函数：只做视图缩放平移，**不修改原始画布像素，不影响蓝牙下发**
 * 注意：我们把原始真实画面临时存到 offscreen，预览只渲染变换后的副本
 */
let offscreenCanvas = null;
function renderPreview(){
    if(!offscreenCanvas){
        offscreenCanvas = document.createElement('canvas');
    }
    // 把当前真实画布拷贝到离屏缓存（原始像素，不会被预览变换破坏）
    offscreenCanvas.width = canvas.width;
    offscreenCanvas.height = canvas.height;
    const offCtx = offscreenCanvas.getContext('2d');
    offCtx.drawImage(canvas,0,0);

    // 清空屏幕显示的主画布
    ctx.clearRect(0,0,canvas.width,canvas.height);

    // 应用预览视图变换
    ctx.save();
    ctx.translate(viewOffsetX, viewOffsetY);
    ctx.scale(viewScale, viewScale);

    // 绘制原始画面
    ctx.drawImage(offscreenCanvas,0,0);
    ctx.restore();
}
function redrawImageLayer(){
    if(!origLoadedImage) return;

    //保存画布状态
    ctx.save();
    ctx.fillStyle = "white";
    ctx.fillRect(0,0,canvas.width,canvas.height);

    //第一步：重绘手绘、文字（完全不受图片缩放影响）
    redrawTextElements();
    redrawLineSegments();

    //第二步：绘制【经过缩放偏移变换的图片图层】
    ctx.save();
    //图片原点偏移
    ctx.translate(imgOffsetX, imgOffsetY);
    ctx.scale(imgScale, imgScale);
    ctx.drawImage(origLoadedImage,0,0);
    ctx.restore();

    ctx.restore();
}
function resetImageTransform(){
    if(!origLoadedImage) return;
    imgScale = 1.0;
    imgOffsetX = 0;
    imgOffsetY = 0;
    const scaleInfoDom = document.getElementById('scaleInfo');
    if(scaleInfoDom) scaleInfoDom.innerText = "100%";
    redrawImageLayer();
}
