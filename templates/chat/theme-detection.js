        // Detect VS Code theme kind
        (function() {
            const body = document.body;
            const observer = new MutationObserver(() => {
                const computedStyle = getComputedStyle(body);
                const bgColor = computedStyle.getPropertyValue('--vscode-editor-background');
                if (bgColor) {
                    // Parse the color to determine if it's light or dark
                    const rgb = bgColor.match(/\d+/g);
                    if (rgb && rgb.length >= 3) {
                        const brightness = (parseInt(rgb[0]) * 299 + parseInt(rgb[1]) * 587 + parseInt(rgb[2]) * 114) / 1000;
                        body.setAttribute('data-vscode-theme-kind', brightness > 128 ? 'vscode-light' : 'vscode-dark');
                    }
                }
            });
            observer.observe(body, { attributes: true, attributeFilter: ['class', 'style'] });
            // Initial detection
            setTimeout(() => {
                const computedStyle = getComputedStyle(body);
                const bgColor = computedStyle.getPropertyValue('--vscode-editor-background');
                if (bgColor) {
                    const rgb = bgColor.match(/\d+/g);
                    if (rgb && rgb.length >= 3) {
                        const brightness = (parseInt(rgb[0]) * 299 + parseInt(rgb[1]) * 587 + parseInt(rgb[2]) * 114) / 1000;
                        body.setAttribute('data-vscode-theme-kind', brightness > 128 ? 'vscode-light' : 'vscode-dark');
                    }
                }
            }, 100);
        })();
