import chalk from 'chalk';

export const diff_formatting_options = {
    'patch': {
        description: 'Generate a patch.',
        type: 'boolean',
        short: 'p',
    },
    'no-patch': {
        description: 'Suppress patch output. Useful for commands that output a patch by default.',
        type: 'boolean',
        short: 's',
    },
    'raw': {
        description: 'Generate diff in raw format.',
        type: 'boolean',
    },
    'patch-with-raw': {
        description: 'Alias for --patch --raw.',
        type: 'boolean',
    },
    'numstat': {
        description: 'Generate a diffstat in a machine-friendly format.',
        type: 'boolean',
    },
    'summary': {
        description: 'List newly added, deleted, or moved files.',
        type: 'boolean',
    },
    'unified': {
        description: 'Generate patches with N lines of context. Implies --patch.',
        type: 'string',
        short: 'U',
    },
    'src-prefix': {
        description: 'Show the given source prefix instead of "a/".',
        type: 'string',
    },
    'dst-prefix': {
        description: 'Show the given destination prefix instead of "b/".',
        type: 'string',
    },
    'no-prefix': {
        description: 'Do not show source or destination prefixes.',
        type: 'boolean',
    },
    'default-prefix': {
        description: 'Use default "a/" and "b/" source and destination prefixes.',
        type: 'boolean',
    },
};

/**
 * Process command-line options related to diff formatting, and return an options object to pass to format_diff().
 * @param options Parsed command-line options.
 * @returns {{raw: boolean, numstat: boolean, summary: boolean, patch: boolean, context_lines: number, no_patch: boolean, source_prefix: string, dest_prefix: string }}
 */
export const process_diff_formatting_options = (options, { show_patch_by_default = true } = {}) => {
    const result = {
        raw: false,
        numstat: false,
        summary: false,
        patch: false,
        context_lines: 3,
        no_patch: false,
        source_prefix: 'a/',
        dest_prefix: 'b/',
    };

    result.display_diff = () => {
        return !result.no_patch && (result.raw || result.numstat || result.summary || result.patch);
    };

    if (options['raw'])
        result.raw = true;
    if (options['numstat'])
        result.numstat = true;
    if (options['summary'])
        result.summary = true;
    if (options['patch'])
        result.patch = true;
    if (options['patch-with-raw']) {
        result.patch = true;
        result.raw = true;
    }
    if (options['unified'] !== undefined) {
        result.patch = true;
        result.context_lines = options['unified'];
    }
    
    // Prefixes
    if (options['src-prefix'])
        result.source_prefix = options['src-prefix'];
    if (options['dst-prefix'])
        result.dest_prefix = options['dst-prefix'];
    if (options['default-prefix']) {
        result.source_prefix = 'a/';
        result.dest_prefix = 'b/';
    }
    if (options['no-prefix']) {
        result.source_prefix = '';
        result.dest_prefix = '';
    }

    // If nothing is specified, default to --patch
    if (show_patch_by_default && !result.raw && !result.numstat && !result.summary && !result.patch)
        result.patch = true;

    // --no-patch overrides the others
    if (options['no-patch'])
        result.no_patch = true;

    return result;
}

/**
 * Produce a string representation of the given diffs.
 * @param diffs A single object, or array of them, in the format:
 *     {
 *         a: { mode, oid },
 *         b: { mode, oid },
 *         diff: object returned by Diff.structuredPatch() - see https://www.npmjs.com/package/diff
 *     }
 * @param options Object returned by process_diff_formatting_options()
 * @returns {string}
 */
export const format_diffs = (diffs, options) => {
    if (!(diffs instanceof Array))
        diffs = [diffs];

    let s = '';
    if (options.raw) {
        // https://git-scm.com/docs/diff-format#_raw_output_format
        for (const { a, b, diff } of diffs) {
            s += `:${a.mode} ${b.mode} ${shorten_hash(a.oid)} ${shorten_hash(b.oid)} `;
            // Status. For now, we just support A/D/M
            if (a.mode === '000000') {
                s += 'A'; // Added
            } else if (b.mode === '000000') {
                s += 'D'; // Deleted
            } else {
                s += 'M'; // Modified
            }
            // TODO: -z option
            s += `\t${diff.oldFileName}\n`;
        }
        s += '\n';
    }

    if (options.numstat) {
        // https://git-scm.com/docs/diff-format#_other_diff_formats
        for (const { a, b, diff } of diffs) {
            const { added_lines, deleted_lines } = diff.hunks.reduce((acc, hunk) => {
                const first_char_counts = hunk.lines.reduce((acc, line) => {
                    acc[line[0]] = (acc[line[0]] || 0) + 1;
                    return acc;
                }, {});
                acc.added_lines += first_char_counts['+'] || 0;
                acc.deleted_lines += first_char_counts['-'] || 0;
                return acc;
            }, { added_lines: 0, deleted_lines: 0 });

            // TODO: -z option
            s += `${added_lines}\t${deleted_lines}\t`;
            if (diff.oldFileName === diff.newFileName) {
                s += `${diff.oldFileName}\n`;
            } else {
                s += `${diff.oldFileName} => ${diff.newFileName}\n`;
            }
        }
    }

    // TODO: --stat / --compact-summary

    if (options.summary) {
        // https://git-scm.com/docs/diff-format#_other_diff_formats
        for (const { a, b, diff } of diffs) {
            if (diff.oldFileName === diff.newFileName)
                continue;

            if (diff.oldFileName === '/dev/null') {
                s += `create mode ${b.mode} ${diff.newFileName}\n`;
            } else if (diff.newFileName === '/dev/null') {
                s += `delete mode ${a.mode} ${diff.oldFileName}\n`;
            } else {
                // TODO: Abbreviate shared parts of path - see git manual link above.
                s += `rename ${diff.oldFileName} => ${diff.newFileName}\n`;
            }
        }
    }

    if (options.patch) {
        for (const { a, b, diff } of diffs) {
            const a_path = diff.oldFileName.startsWith('/') ? diff.oldFileName : `${options.source_prefix}${diff.oldFileName}`;
            const b_path = diff.newFileName.startsWith('/') ? diff.newFileName : `${options.dest_prefix}${diff.newFileName}`;

            // NOTE: This first line shows `a/$newFileName` for files that are new, not `/dev/null`.
            const first_line_a_path = a_path !== '/dev/null' ? a_path : `${options.source_prefix}${diff.newFileName}`;
            s += `diff --git ${first_line_a_path} ${b_path}\n`;
            if (a.mode === b.mode) {
                s += `index ${shorten_hash(a.oid)}..${shorten_hash(b.oid)} ${a.mode}`;
            } else {
                if (a.mode === '000000') {
                    s += `new file mode ${b.mode}\n`;
                } else {
                    s += `old mode ${a.mode}\n`;
                    s += `new mode ${b.mode}\n`;
                }
                s += `index ${shorten_hash(a.oid)}..${shorten_hash(b.oid)}\n`;
            }
            if (!diff.hunks.length)
                continue;

            s += `--- ${a_path}\n`;
            s += `+++ ${b_path}\n`;

            for (const hunk of diff.hunks) {
                s += chalk.blueBright(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n`);

                for (const line of hunk.lines) {
                    switch (line[0]) {
                        case '+':
                            s += chalk.greenBright(`${line}\n`);
                            break;
                        case '-':
                            s += chalk.redBright(`${line}\n`);
                            break;
                        default:
                            s += `${line}\n`;
                            break;
                    }
                }
            }
        }
    }


    return s;
}