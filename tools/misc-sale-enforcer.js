(function () {
  'use strict';

  const BUTTON_ID = 'force-misc-charge-btn';
  const PANEL_ID = 'force-misc-charge-panel';
  const PANEL_HOST_ID = 'force-misc-charge-host';

  const buttonhtml2 = `
    <div id="${PANEL_ID}">
      <h2 id="chargeTitle">Add Miscellaneous Charge</h2>
      <table id="add_expander">
        <tbody>
          <tr>
            <td rowspan="4" class="note" style="width: 600px;">
              <textarea
                oninput="window.validateField(this);"
                onblur="window.validateField(this);"
                data-validation="checkForCreditCardInfo"
                name="note"
                class="add_expander error_no_empty_notes"
                tabindex="2000"
                cols="25"
                rows="5"
                id="add_misc_description"
              >Miscellaneous Charge</textarea>
              <div class="error-tracker" style="display: none;"></div>
              <div class="sensitive-info-error" data-test="error-message-container">
                <span class="icon-warning-sign"></span>
                <span class="text-content">You entered sensitive information like credit card details. Remove before continuing.</span>
              </div>
            </td>

            <td><label>Price</label></td>
            <td>
              <div class="money-field-container money-line-edit">
                <input
                  name="price"
                  type="text"
                  class="add_expander money"
                  tabindex="2001"
                  size="6"
                  maxlength="15"
                  onfocus="selectField(this);"
                  onchange="validateMoneyForDisplay(this); return true;"
                  value="0.00"
                  step=".01"
                  onkeypress="if (onEnterKey(event,function () { window.merchantos.register.submitAddExpander('add_misc', this); })) return false;"
                >
              </div>
            </td>

            <td><label>Discount</label></td>
            <td>
              <select
                name="discount_id"
                class="add_expander"
                tabindex="2005"
                onkeypress="if (onEnterKey(event,function () { window.merchantos.register.submitAddExpander('add_misc', this); })) return false;"
                notranslate=""
              >
                <option value="0">--</option>
              </select>
            </td>
          </tr>

          <tr>
            <td><label>Cost</label></td>
            <td>
              <div class="money-field-container money-line-edit">
                <input
                  name="cost"
                  type="text"
                  class="add_expander money"
                  tabindex="2002"
                  size="6"
                  maxlength="15"
                  onfocus="selectField(this);"
                  onchange="validateMoneyForDisplay(this); return true;"
                  value="0.00"
                  step=".01"
                  onkeypress="if (onEnterKey(event,function () { window.merchantos.register.submitAddExpander('add_misc', this); })) return false;"
                >
              </div>
            </td>

            <td><label>Tax Class</label></td>
            <td>
              <select
                name="class_id"
                class="add_expander"
                tabindex="2006"
                onkeypress="if (onEnterKey(event,function () { window.merchantos.register.submitAddExpander('add_misc', this); })) return false;"
              >
                <option value="1" notranslate="">Item</option>
                <option value="2" notranslate="">Labor</option>
                <option value="7" notranslate=""></option>
              </select>
            </td>
          </tr>

          <tr>
            <td><label>Qty</label></td>
            <td>
              <input
                name="quantity"
                type="number"
                class="add_expander number"
                tabindex="2003"
                size="6"
                maxlength="15"
                onfocus="selectField(this);"
                onchange="parseNumberChange(this); return true;"
                value="1"
                onkeypress="if (onEnterKey(event,function () { window.merchantos.register.submitAddExpander('add_misc', this); })) return false;"
              >
            </td>

            <td><label>Employee</label></td>
            <td>
              <select
                name="employee_id"
                class="add_expander"
                tabindex="2007"
                onkeypress="if (onEnterKey(event,function () { window.merchantos.register.submitAddExpander('add_misc', this); })) return false;"
                notranslate=""
              >
                <option value="1" selected="selected">Default</option>
              </select>
            </td>
          </tr>

          <tr>
            <td></td>
            <td colspan="3">
              <label class="checkbox">
                <input
                  name="tax"
                  type="checkbox"
                  class="add_expander"
                  tabindex="2004"
                  checked="checked"
                  onkeypress="if (onEnterKey(event,function () { window.merchantos.register.submitAddExpander('add_misc', this); })) return false;"
                > Tax
              </label>
            </td>
          </tr>

          <tr>
            <td colspan="4" class="submit">
              <button
                id="saveChargeButton"
                tabindex="2008"
                onclick="window.merchantos.register.submitAddExpander('add_misc', this); return false;"
                class="gui-def-button"
              >Save</button>
              <button
                id="cancelChargeButton"
                tabindex="2009"
                onclick="document.getElementById('${PANEL_HOST_ID}')?.style.setProperty('display','none'); window.merchantos.focus.set('add_search_item_text'); return false;"
                class="gui-def-button"
              >Cancel</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  function log(...args) {
    console.log('[Misc Sale Enforcer]', ...args);
  }

  function getNavTarget() {
    return (
      document.querySelector('#register nav') ||
      document.querySelector('#register section nav')
    );
  }

  function ensurePanelHost() {
    let host = document.getElementById(PANEL_HOST_ID);
    if (host) return host;

    const existingExpander = document.getElementById('add_expander_holder');
    if (existingExpander && existingExpander.parentElement) {
      host = document.createElement('div');
      host.id = PANEL_HOST_ID;
      host.style.display = 'none';
      existingExpander.parentElement.insertBefore(host, existingExpander.nextSibling);
      return host;
    }

    const register = document.getElementById('register') || document.body;
    host = document.createElement('div');
    host.id = PANEL_HOST_ID;
    host.style.display = 'none';
    register.appendChild(host);
    return host;
  }

  function showMiscPanel() {
    const host = ensurePanelHost();
    host.innerHTML = buttonhtml2;
    host.style.display = 'block';

    const saveBtn = document.getElementById('saveChargeButton');
    if (saveBtn) saveBtn.focus();
  }

  function createButton() {
    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.textContent = 'Force Misc Charge';
    btn.className = 'gui-def-button';
    btn.style.backgroundColor = '#bd0808';
    btn.style.color = '#fff';
    btn.style.cursor = 'pointer';
    btn.style.marginLeft = '8px';

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      showMiscPanel();
    });

    return btn;
  }

  function ensureButton() {
    if (document.getElementById(BUTTON_ID)) return;

    const nav = getNavTarget();
    if (!nav) return;

    nav.appendChild(createButton());
    log('Button appended.');
  }

  function installObservers() {
    const observer = new MutationObserver(() => {
      ensureButton();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    setInterval(ensureButton, 1000);
    ensureButton();
    log('Observers installed.');
  }

  function init() {
    installObservers();
    log('By the will of the Omnissiah, this machine awakens once again.');
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
