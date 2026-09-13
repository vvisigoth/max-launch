import { decode, toHex, type TimedMessage } from '@lcxl3/core';

const useColour = process.stdout.isTTY === true && process.env['NO_COLOR'] === undefined;

const paint = (code: string, text: string): string => (useColour ? `\u001b[${code}m${text}\u001b[0m` : text);

const dim = (text: string): string => paint('2', text);
const cyan = (text: string): string => paint('36', text);
const yellow = (text: string): string => paint('33', text);

const PORT_WIDTH = 8;

/**
 * One line per message: timestamp, direction arrow, port, decoded meaning, raw
 * bytes. Long SysEx is truncated in the hex column because a 1216-byte bitmap
 * would otherwise bury everything around it - the full bytes are in the capture
 * file if a trace is being recorded.
 */
export const formatMessage = (message: TimedMessage): string => {
  const time = dim((message.at / 1000).toFixed(3).padStart(9));
  const arrow = message.direction === 'toDevice' ? cyan('-->') : yellow('<--');
  const port = message.port.padEnd(PORT_WIDTH);
  const { summary, detail } = decode(message.bytes, message.direction);

  const hex = message.bytes.length > 16 ? `${toHex(message.bytes.slice(0, 16))} ... (${message.bytes.length} bytes)` : toHex(message.bytes);

  const head = `${time} ${arrow} ${port} ${summary}`;
  return detail === undefined ? `${head}  ${dim(hex)}` : `${head}  ${dim(hex)}\n${' '.repeat(14)}${dim(detail)}`;
};

export const logMessage = (message: TimedMessage): void => {
  console.log(formatMessage(message));
};
