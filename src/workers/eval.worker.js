// worker.js
self.onmessage = function (e) {
    const userCode = e.data;

    // 1. Capture Console Output
    // We want the user to see their console.logs, so we hijack it.
    let logs = [];
    const mockConsole = {
        log: (...args) => {
            // Convert args to strings and store them
            logs.push(args.map(a => String(a)).join(' '));
        },
        error: (...args) => {
            logs.push("ERROR: " + args.map(a => String(a)).join(' '));
        }
    };

    // 2. Security: Nuke Network Access
    // Even without cookies, we don't want them using your user's browser 
    // to DDOS other sites or fetch malicious data.
    self.fetch = undefined;
    self.XMLHttpRequest = undefined;
    self.importScripts = undefined; // Prevent loading external scripts

    try {
        // 3. Execute Code
        // We use 'new Function' to limit scope (it doesn't see local worker variables)
        // We pass 'console' as an argument so they use our mockConsole
        const runUserCode = new Function('console', userCode);

        const result = runUserCode(mockConsole);

        // 4. Send back results
        self.postMessage({
            success: true,
            result: result, // The return value of the code
            logs: logs      // The captured console.logs
        });

    } catch (error) {
        self.postMessage({
            success: false,
            error: error.message,
            logs: logs
        });
    }
};