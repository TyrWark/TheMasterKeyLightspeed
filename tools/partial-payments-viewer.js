/* globals jQuery, $, waitForKeyElements */

const timer = ms => new Promise(res => setTimeout(res, ms))

var PTArray = [[]]
var PaymentProvider = []
var LSPayCheck = false
var Payments = [[]]
var sid = 0
var matcharray = []
var namearray = []
var final = []
var Headers = ["Payment Type", "Charge Total", "Archived", "salePaymentID"]
var pagematch = ""
var table
var numberofrows = 0


//Get Sale ID
function getSaleID(){
    sid = (document.location.href).split("id=")[1].split("&")[0];
}

// Reads the account id from the page's own global instead of scraping the #help_account_id DOM node
function getAccountId(){
    if(window.__mkl){
        var id = window.__mkl.getAccountId()
        if(id) return id
    }
    if(window.merchantos && window.merchantos.account) return window.merchantos.account.id
    if(typeof unsafeWindow !== 'undefined' && unsafeWindow.merchantos && unsafeWindow.merchantos.account) return unsafeWindow.merchantos.account.id
    return null
}

//Grab all Payments on a Sale
function getSalePayments(){
    return new Promise(function(resolve, reject){
        var accountId = getAccountId()
        if(!accountId){
            console.error("[PartialPayments] Could not resolve account id (window.merchantos.account.id)")
            reject(new Error("account id not found"))
            return
        }
        $.getJSON(
            location.origin+'/API/Account/'+accountId+'/Sale/'+sid+'.json?load_relations=all'
        ).done(function(json){
            var Saleinfo = json.Sale.SalePayments && json.Sale.SalePayments.SalePayment
            console.log(json.Sale)

            // Normalize: API returns object for 1 payment, array for multiple, and omits the key entirely for none
            var entries = Saleinfo ? (Array.isArray(Saleinfo) ? Saleinfo : [Saleinfo]) : []

            Payments = [Headers]
            for (var entry of entries) {
                Payments.push([
                    entry.PaymentType.name,
                    "$" + entry.amount,
                    entry.archived,
                    entry.salePaymentID
                ])
            }
            if(entries.length === 0){
                Payments.push(["No payments found", "", "", ""])
            }

            console.log("_____Payment List Below_____")
            console.log("Format = Payment Type, Amount, Archived, salePaymentID")
            console.log(Payments)
            console.log("_____Payment List Above_____")
            resolve()
        }).fail(function(jqXHR, textStatus){
            console.error("[PartialPayments] getSalePayments API request failed:", textStatus, jqXHR && jqXHR.status)
            resolve()
        })
    })
}

// Fires based on whether the payments tab container is actually in the DOM, rather than a URL
// regex match, since this app doesn't reliably signal tab-switches via pushState/URL alone.
function isPaymentsTabActive(){
    return Boolean(document.getElementById("admin_utilities_payments_view_single"))
}

function syncForCurrentPage(){
    if(isPaymentsTabActive()){
        if(!document.getElementById("myContainer")){
            // Main() is async - without this catch, failures vanish as unhandled rejections
            Main().catch(function(err){ console.error("[PartialPayments] Main() failed:", err) })
        }
    } else {
        try{ document.getElementById("myContainer").remove() }catch{ null }
    }
}

let syncScheduled = false
function scheduleSync(){
    if(syncScheduled) return
    syncScheduled = true
    window.requestAnimationFrame(function(){
        syncScheduled = false
        syncForCurrentPage()
    })
}

// route hook is installed once by the master loader; subscribe instead of patching history ourselves
window.__mkl && window.__mkl.onRouteChange(scheduleSync)
new MutationObserver(scheduleSync)
    .observe(document.documentElement || document.body, { childList: true, subtree: true })
// Returns rows from the payment table, handling both nested (multi-payment) and flat (single-payment) layouts
function getPaymentRows(){
    var innerTbody = document.querySelector("#admin_utilities_payments_view_single table table tbody")
    if(innerTbody && innerTbody.rows.length > 0){
        return Array.from(innerTbody.rows)
    }
    var outerTbody = document.querySelector("#admin_utilities_payments_view_single table tbody")
    return outerTbody ? Array.from(outerTbody.rows) : []
}

//Creates Clickable link to payref for LSPayments charges
function LinkGenerator(){
    console.log("LSPayCC")
    var rows = getPaymentRows()

    rows.forEach(function(row, index){
        if(index === 0) return // skip header row
        var cell = row.cells[3]
        if(!cell) return
        var PayID = cell.textContent.trim()
        if(PayID){
            cell.innerHTML = '<a href="https://us.merchantos.com/reports/payment/retail/' + PayID + '">' + PayID + '</a>'
        }
    })

    ExtraDeets(rows)
}

//Checks if the Payments Provider is LSPay or 3rd Party Integrated
//Returns a Promise<boolean> — true if any payment used a ccChargeID (LSPay)
function PayProvider(){
    return new Promise(function(resolve){
        var accountId = getAccountId()
        if(!accountId){
            console.error("[PartialPayments] PayProvider: could not resolve account id, defaulting to false")
            resolve(false)
            return
        }
        $.getJSON(
            location.origin+'/API/Account/'+accountId+'/Sale/'+sid+'.json?load_relations=["SalePayments"]'
        ).done(function(json){
            var Saleinfo = json.Sale.SalePayments && json.Sale.SalePayments.SalePayment
            var entries = Saleinfo ? (Array.isArray(Saleinfo) ? Saleinfo : [Saleinfo]) : []
            var hasLSPay = entries.some(function(entry){ return entry.ccChargeID !== "0" })
            console.log("Has LSPay charges:", hasLSPay)
            resolve(hasLSPay)
        }).fail(function(jqXHR, textStatus){
            console.error("[PartialPayments] PayProvider request failed, defaulting to false:", textStatus, jqXHR && jqXHR.status)
            resolve(false)
        })
    })
}

//Creates Clickable link to payref for Non-LSPayments charges
function CCChargeGen(){
    console.log("NonLSPayCC")
    var rows = getPaymentRows()

    rows.forEach(function(row, index){
        if(index === 0) return // skip header row
        var cell = row.cells[3]
        if(!cell) return
        var PayID = cell.textContent.trim()
        if(PayID){
            cell.innerHTML = '<a href="https://us.merchantos.com/?name=reports.register.views.payment&form_name=view&id=' + PayID + '&tab=ccard">' + PayID + '</a>'
        }
    })
}

//Rebuilds the table in the UI
function BuildTable(){


    //setup our table array
    var tableArr = Payments
    //create a Table Object
    table = document.createElement('table');
    //iterate over every array(row) within tableArr
    for (let row of tableArr) {
        //Insert a new row element into the table element
        table.insertRow();
        //Iterate over every index(cell) in each array(row)
        for (let cell of row) {
            //While iterating over the index(cell)
            //insert a cell into the table element
            let newCell = table.rows[table.rows.length - 1].insertCell();
            //add text to the created cell element
            newCell.textContent = cell;
        }
    }


}

async function ButtonClickAction (zEvent) {

    //Gut the table to use for ourselves
    try{
        document.querySelector("#admin_utilities_payments_view_single > div > table > tbody").innerHTML=""
    }
    catch{
        try{ document.querySelector("#noAdjustPaymentsFound").innerHTML="" }catch{ null }
    }

    try{
        document.querySelector("#admin_utilities_payments_view_single > div > table > thead > tr").remove()
    }
    catch{
        try{ document.querySelector("#noAdjustPaymentsFound").remove() }catch{ null }
    }

    BuildTable()

    //append the compiled table to the DOM
    try{
        document.querySelector("#admin_utilities_payments_view_single > div > table > tbody").appendChild(table);
    }
    catch{
        document.querySelector("#admin_utilities_payments_view_single > div > div").appendChild(table)
    }
    document.getElementById("myContainer").remove()

    // Await PayProvider so we don't race against the AJAX response
    LSPayCheck = await PayProvider()
    console.log("LSPayCheck:", LSPayCheck)

    if(LSPayCheck){
        CCChargeGen()
    } else {
        LinkGenerator()
    }

}

function CreateButton(){


    if(document.getElementById ("myContainer") === null){



        var zNode = document.createElement ('div');
        zNode.innerHTML = '<button id="myButton" type="button">'
            + 'Fetch Payments</button>'
        ;
        zNode.setAttribute ('id', 'myContainer');



        var anchor = document.querySelector("#printGiftReceiptButton") || document.querySelector("#printQuoteButton")
        if(!anchor){
            console.error("[PartialPayments] Could not find #printGiftReceiptButton or #printQuoteButton to attach button next to")
            return
        }
        anchor.after(zNode);




        //--- Activate the newly added button.
        document.getElementById ("myButton").addEventListener (
            "click", ButtonClickAction, false
        );


    }else{console.log("Button Already Exists")}




}

//Main Engine
async function Main(){
    //Clear out arrays in case this is run multiple times before a page refresh
    PTArray = [[]]
    Payments = [[]]

    getSaleID()
    await getSalePayments()
    CreateButton()
}


function ExtraDeets(rows){
    if(!rows || rows.length === 0){
        rows = getPaymentRows()
    }

    rows.forEach(function(row, index){
        var x = row.insertCell(4)
        if(index === 0){
            x.innerHTML = "Archive Link"
            return
        }
        // textContent gives us the plain ID even after LinkGenerator has set an <a> tag in cell 3
        var payCell = row.cells[3]
        if(!payCell) return
        var SID = payCell.textContent.trim()
        if(SID){
            x.innerHTML = '<a href="https://us.merchantos.com/?name=reports.register.views.payment&form_name=view&id=' + SID + '&tab=ccard">' + SID + '</a>'
        }
    })
}


//Start Point
scheduleSync()
