import { posix, win32 } from 'node:path'

/**
 * Environment defaults inherited by the engine and its official shell tools.
 * Keep the bundled Node discoverable and Python's default text I/O compatible
 * with the UTF-8 subprocess collector, without changing explicit user choices.
 */
export function runtimeEnvironmentOverrides({ nodeExe, pythonBin, env = process.env, platform = process.platform }) {
  const paths = platform === 'win32' ? win32 : posix
  const keyFor = name => Object.keys(env).find(key => platform === 'win32' ? key.toUpperCase() === name : key === name)
  const overrides = {}
  if (paths.isAbsolute(nodeExe) || (typeof pythonBin === 'string' && paths.isAbsolute(pythonBin))) {
    const key = keyFor('PATH') ?? 'PATH'
    overrides[key] = [pythonBin && paths.isAbsolute(pythonBin) ? pythonBin : '', paths.isAbsolute(nodeExe) ? paths.dirname(nodeExe) : '', env[key] ?? ''].filter(Boolean).join(paths.delimiter)
  }
  const pythonUtf8Key = keyFor('PYTHONUTF8')
  if (pythonUtf8Key === undefined || env[pythonUtf8Key] === undefined) overrides[pythonUtf8Key ?? 'PYTHONUTF8'] = '1'
  if (typeof pythonBin === 'string' && paths.isAbsolute(pythonBin)) {
    overrides[keyFor('PYTHONHOME') ?? 'PYTHONHOME'] = ''
    overrides[keyFor('PYTHONPATH') ?? 'PYTHONPATH'] = ''
    overrides[keyFor('PYTHONNOUSERSITE') ?? 'PYTHONNOUSERSITE'] = '1'
    overrides[keyFor('PYTHONDONTWRITEBYTECODE') ?? 'PYTHONDONTWRITEBYTECODE'] = '1'
    if (platform === 'darwin') {
      // A parent framework launcher must not redirect the managed interpreter.
      overrides.PYTHONEXECUTABLE = undefined
      overrides.__PYVENV_LAUNCHER__ = undefined
    }
  }
  return overrides
}
