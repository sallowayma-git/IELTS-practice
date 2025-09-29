// cleanupGuide.js - Guide for cleaning up obsolete code files
// This file documents which files can be safely removed after refactoring

window.CleanupGuide = class CleanupGuide {
    constructor() {
        this.obsoleteFiles = [];
        this.keepFiles = [];
        this.modifiedFiles = [];
        this.newFiles = [];
        
        this.analyzeCodebase();
    }
    
    analyzeCodebase() {
        // Files that are now obsolete and can be removed
        this.obsoleteFiles = [
            // Complex initialization files that are replaced
            'js/boot-fallbacks.js', // Replaced by new error handling
            
            // Redundant utility files
            'js/utils/componentChecker.js', // Functionality moved to new architecture
            
            // Old component files that might be replaced
            // Note: Be careful with these, check dependencies first
            'js/components/BrowseStateManager.js', // Replaced by ExamBrowser
            'js/components/ErrorFixer.js', // Replaced by honest error handling
            'js/components/CommunicationRecovery.js', // Replaced by new communication system
            
            // Performance optimization files that may be redundant
            'js/components/PerformanceOptimizer.js', // May be replaced by simpler approach
            
            // Old patches that may no longer be needed
            'js/patches/runtime-fixes.js' // Check if still needed
        ];
        
        // Files that should be kept (essential for backward compatibility)
        this.keepFiles = [
            // Core storage and data management
            'js/utils/storage.js',
            'js/utils/dataBackupManager.js',
            'js/components/dataManagementPanel.js',
            
            // Core functionality
            'js/core/scoreStorage.js',
            'js/core/practiceRecorder.js',
            'js/components/PDFHandler.js',
            
            // Essential components
            'js/components/IndexValidator.js',
            'js/components/CommunicationTester.js',
            'js/components/DataIntegrityManager.js',
            
            // User interface enhancements
            'js/utils/markdownExporter.js',
            'js/components/practiceRecordModal.js',
            'js/components/practiceHistoryEnhancer.js',
            'js/theme-switcher.js',
            
            // Main application files
            'js/main.js', // Now contains new architecture
            'js/app.js', // Modified for compatibility
            'js/script.js' // Core functionality
        ];
        
        // Files that have been modified for new architecture
        this.modifiedFiles = [
            {
                file: 'js/main.js',
                changes: 'Now contains new App class with proper initialization'
            },
            {
                file: 'js/app.js',
                changes: 'Simplified ExamSystemApp for compatibility with new architecture'
            },
            {
                file: 'js/script.js',
                changes: 'Replaced silent error handling with explicit error management'
            },
            {
                file: 'js/theme-switcher.js',
                changes: 'Improved error handling'
            },
            {
                file: 'js/utils/markdownExporter.js',
                changes: 'Better error handling for data processing'
            },
            {
                file: 'js/utils/dataBackupManager.js',
                changes: 'Explicit error logging instead of silent failures'
            },
            {
                file: 'index.html',
                changes: 'Added new architecture script loading order'
            }
        ];
        
        // New files added by the refactoring
        this.newFiles = [
            // Core stores
            'js/stores/ExamStore.js',
            'js/stores/RecordStore.js',
            'js/stores/AppStore.js',
            
            // UI components
            'js/ui/ExamBrowser.js',
            'js/ui/RecordViewer.js',
            'js/ui/SettingsPanel.js',
            
            // Utilities
            'js/utils/validation.js',
            'js/utils/events.js',
            'js/utils/errorDisplay.js',
            
            // Testing
            'js/utils/systemTest.js',
            'js/utils/communicationTest.js',
            'js/utils/cleanupGuide.js'
        ];
    }
    
    generateCleanupReport() {
        console.log('\n' + '='.repeat(60));
        console.log('CODE CLEANUP GUIDE');
        console.log('='.repeat(60));
        
        console.log('\n📁 NEW ARCHITECTURE FILES:');
        this.newFiles.forEach(file => {
            console.log(`  ✅ ${file}`);
        });
        
        console.log('\n📝 MODIFIED FILES:');
        this.modifiedFiles.forEach(item => {
            console.log(`  🔄 ${item.file}`);
            console.log(`     ${item.changes}`);
        });
        
        console.log('\n💾 KEEP THESE FILES:');
        this.keepFiles.forEach(file => {
            console.log(`  ✅ ${file}`);
        });
        
        console.log('\n🗑️  POTENTIALLY OBSOLETE FILES:');
        console.log('   ⚠️  Check dependencies before removing!');
        this.obsoleteFiles.forEach(file => {
            console.log(`  ❓ ${file}`);
        });
        
        console.log('\n' + '='.repeat(60));
        console.log('CLEANUP INSTRUCTIONS:');
        console.log('='.repeat(60));
        console.log('1. Test the new system thoroughly');
        console.log('2. Check each obsolete file for dependencies');
        console.log('3. Remove files one by one and test after each removal');
        console.log('4. Keep backups of removed files until system is stable');
        console.log('5. Update any remaining references to removed files');
        console.log('='.repeat(60));
        
        return {
            newFiles: this.newFiles,
            modifiedFiles: this.modifiedFiles,
            keepFiles: this.keepFiles,
            obsoleteFiles: this.obsoleteFiles
        };
    }
    
    checkFileDependencies(filename) {
        console.log(`\n🔍 Checking dependencies for: ${filename}`);
        
        // This would need to be implemented to actually scan files
        // For now, provide manual guidance
        const dependencyChecks = {
            'js/boot-fallbacks.js': [
                'Check if any files call boot fallback functions',
                'Look for references to fallback initialization'
            ],
            'js/utils/componentChecker.js': [
                'Check if any components use componentChecker functions',
                'Look for component availability checks'
            ],
            'js/components/BrowseStateManager.js': [
                'Check if browse view uses BrowseStateManager',
                'Look for state management calls in browse functionality'
            ],
            'js/components/ErrorFixer.js': [
                'Check if any error handling code calls ErrorFixer',
                'Look for automatic error recovery attempts'
            ],
            'js/components/CommunicationRecovery.js': [
                'Check if exam windows use communication recovery',
                'Look for postMessage error handling'
            ],
            'js/components/PerformanceOptimizer.js': [
                'Check if any code calls performance optimization',
                'Look for cleanup or optimization calls'
            ],
            'js/patches/runtime-fixes.js': [
                'Check if runtime fixes are still needed',
                'Look for browser compatibility issues'
            ]
        };
        
        const checks = dependencyChecks[filename];
        if (checks) {
            console.log('Manual checks needed:');
            checks.forEach((check, index) => {
                console.log(`  ${index + 1}. ${check}`);
            });
        } else {
            console.log('No specific dependency checks defined for this file.');
        }
        
        return checks || [];
    }
    
    suggestRemovalOrder() {
        console.log('\n📋 SUGGESTED REMOVAL ORDER:');
        console.log('Remove files in this order to minimize risk:');
        
        const removalOrder = [
            {
                file: 'js/patches/runtime-fixes.js',
                reason: 'Patches may no longer be needed with new architecture',
                risk: 'Low'
            },
            {
                file: 'js/boot-fallbacks.js',
                reason: 'Fallback initialization replaced by new error handling',
                risk: 'Low'
            },
            {
                file: 'js/utils/componentChecker.js',
                reason: 'Component checking moved to new architecture',
                risk: 'Medium'
            },
            {
                file: 'js/components/ErrorFixer.js',
                reason: 'Error fixing replaced by honest error handling',
                risk: 'Medium'
            },
            {
                file: 'js/components/CommunicationRecovery.js',
                reason: 'Communication recovery replaced by new system',
                risk: 'Medium'
            },
            {
                file: 'js/components/PerformanceOptimizer.js',
                reason: 'Performance optimization may be redundant',
                risk: 'High'
            },
            {
                file: 'js/components/BrowseStateManager.js',
                reason: 'Browse state management replaced by ExamBrowser',
                risk: 'High'
            }
        ];
        
        removalOrder.forEach((item, index) => {
            console.log(`  ${index + 1}. ${item.file}`);
            console.log(`     Reason: ${item.reason}`);
            console.log(`     Risk: ${item.risk}`);
            console.log('');
        });
        
        return removalOrder;
    }
    
    validateNewArchitecture() {
        console.log('\n🔍 VALIDATING NEW ARCHITECTURE:');
        
        const validationChecks = [
            {
                check: 'All new store classes are available',
                test: () => window.ExamStore && window.RecordStore && window.AppStore
            },
            {
                check: 'All new UI components are available',
                test: () => window.ExamBrowser && window.RecordViewer && window.SettingsPanel
            },
            {
                check: 'Validation functions are available',
                test: () => window.validateExam && window.validateRecord
            },
            {
                check: 'Event system is available',
                test: () => window.EventEmitter && window.globalEventBus
            },
            {
                check: 'Error display system is available',
                test: () => window.ErrorDisplay && window.errorDisplay
            },
            {
                check: 'Main app is initialized',
                test: () => window.app && window.app.isInitialized && window.app.isInitialized()
            },
            {
                check: 'Legacy app is available for compatibility',
                test: () => window.examSystemApp && window.examSystemApp.isInitialized
            }
        ];
        
        let passed = 0;
        let failed = 0;
        
        validationChecks.forEach(item => {
            try {
                if (item.test()) {
                    console.log(`  ✅ ${item.check}`);
                    passed++;
                } else {
                    console.log(`  ❌ ${item.check}`);
                    failed++;
                }
            } catch (error) {
                console.log(`  ❌ ${item.check} (Error: ${error.message})`);
                failed++;
            }
        });
        
        console.log(`\nValidation Results: ${passed} passed, ${failed} failed`);
        
        if (failed === 0) {
            console.log('✅ New architecture is ready for cleanup!');
        } else {
            console.log('⚠️  Fix validation issues before proceeding with cleanup');
        }
        
        return { passed, failed, total: validationChecks.length };
    }
};

// Global functions
window.generateCleanupReport = function() {
    const guide = new window.CleanupGuide();
    return guide.generateCleanupReport();
};

window.checkFileDependencies = function(filename) {
    const guide = new window.CleanupGuide();
    return guide.checkFileDependencies(filename);
};

window.suggestRemovalOrder = function() {
    const guide = new window.CleanupGuide();
    return guide.suggestRemovalOrder();
};

window.validateNewArchitecture = function() {
    const guide = new window.CleanupGuide();
    return guide.validateNewArchitecture();
};

// Auto-generate report in debug mode
if (localStorage.getItem('show_cleanup_guide') === 'true') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            window.generateCleanupReport();
            window.validateNewArchitecture();
        }, 3000);
    });
}