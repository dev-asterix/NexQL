import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as sinon from 'sinon';
import { JSDOM } from 'jsdom';

describe('chat template scroll behavior', () => {
  const scriptPath = path.join(process.cwd(), 'templates/chat/scripts.js');

  let sandbox: sinon.SinonSandbox;
  let dom: JSDOM;
  let windowRef: Window & typeof globalThis;
  let messagesContainer: HTMLElement;
  let scrollIntoViewSpy: sinon.SinonSpy;
  let scrollToSpy: sinon.SinonSpy;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    dom = new JSDOM(
      `<!doctype html>
       <html>
         <body>
           <div id="messagesContainer">
             <div id="typingIndicator"></div>
           </div>
           <textarea id="chatInput"></textarea>
           <button id="sendBtn"></button>
           <button id="stopBtn"></button>
           <button id="attachBtn"></button>
           <button id="mentionBtn"></button>
           <button id="imageBtn"></button>
           <div id="emptyState"></div>
           <div id="loadingText"></div>
           <div id="attachmentsContainer"></div>
           <div id="inputWrapper"></div>
           <div id="historyOverlay"></div>
           <div id="historyList"></div>
           <input id="historySearch" />
           <div id="mentionPicker"></div>
           <input id="mentionSearch" />
           <div id="mentionList"></div>
           <div id="imagePreviewStrip"></div>
           <input id="imageFileInput" />
           <div id="contextBar"></div>
           <div id="contextConnection"></div>
           <div id="contextTable"></div>
           <div id="errorCard"></div>
           <div id="errorCardTitle"></div>
           <div id="errorCardMessage"></div>
           <div id="inputWrapper"></div>
         </body>
       </html>`,
      { runScripts: 'outside-only', url: 'http://localhost/' }
    );

    windowRef = dom.window as Window & typeof globalThis;
    (windowRef as any).acquireVsCodeApi = () => ({ postMessage: sandbox.stub() });

    scrollIntoViewSpy = sandbox.spy();
    Object.defineProperty(windowRef.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoViewSpy
    });

    messagesContainer = windowRef.document.getElementById('messagesContainer') as HTMLElement;
    scrollToSpy = sandbox.spy();
    (messagesContainer as any).scrollTo = scrollToSpy;
    Object.defineProperty(messagesContainer, 'scrollHeight', {
      configurable: true,
      get: () => 4800,
    });

    windowRef.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    }) as typeof window.requestAnimationFrame;

    windowRef.eval(fs.readFileSync(scriptPath, 'utf8'));
  });

  afterEach(() => {
    sandbox.restore();
    dom.window.close();
  });

  it('anchors the assistant message to the start when the last turn is the model', () => {
    windowRef.renderMessages(
      [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Here is the answer.' }
      ],
      false
    );

    const assistantMessage = windowRef.document.querySelector('.message.assistant') as HTMLElement;
    expect(assistantMessage).to.exist;
    expect(scrollIntoViewSpy.callCount).to.be.greaterThan(0);
    const lastCall = scrollIntoViewSpy.getCall(scrollIntoViewSpy.callCount - 1);
    expect((lastCall.thisValue as HTMLElement).classList.contains('assistant')).to.equal(
      true,
      'last scrollIntoView should be on the assistant turn'
    );
    expect(lastCall.args[0]).to.deep.include({ block: 'start' });
    expect(scrollToSpy.called).to.be.false;
  });

  it('scrolls to composer when the last turn is the user (after send)', () => {
    windowRef.renderMessages([{ role: 'user', content: 'Next question' }], false);

    const userMessage = windowRef.document.querySelector('.message.user') as HTMLElement;
    expect(userMessage).to.exist;
    expect(scrollToSpy.called).to.be.true;
    const inputWrap = windowRef.document.getElementById('inputWrapper') as HTMLElement;
    expect(scrollIntoViewSpy.called).to.be.true;
    const lastIv = scrollIntoViewSpy.getCall(scrollIntoViewSpy.callCount - 1);
    expect(lastIv.thisValue).to.equal(inputWrap);
    expect(lastIv.args[0]).to.deep.include({ block: 'end' });
  });
});
