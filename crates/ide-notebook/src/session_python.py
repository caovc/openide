"""OpenIDE's ipykernel variables adapter; no evaluation of user expressions."""
from IPython import get_ipython
import itertools
import types

ip = get_ipython()
comms = {}
LIMIT = 200


def children(value):
    if type(value) is dict:
        return [(str(i), key, item) for i, (key, item) in
                enumerate(itertools.islice(value.items(), LIMIT))]
    if type(value) in (list, tuple):
        return [(str(i), i, item) for i, item in enumerate(value[:LIMIT])]
    return []


def label(value):
    if type(value) in (str, int, float, bool, type(None)):
        try:
            return repr(value)[:160]
        except Exception:
            return '<value>'
    return '<' + type(value).__name__ + '>'


def variable(key, name, value):
    container = type(value) in (dict, list, tuple)
    summary = str(len(value)) + ' items' if container else label(value)
    return dict(access_key=key, display_name=str(name)[:160],
                display_type=type(value).__name__, display_value=summary,
                has_children=container and len(value) > 0)


def roots():
    hidden = {'In', 'Out', 'get_ipython', 'exit', 'quit', 'open'}
    values = [(name, value) for name, value in list(ip.user_ns.items())
              if not name.startswith('_') and name not in hidden
              and not isinstance(value, types.ModuleType)]
    values.sort(key=lambda pair: pair[0])
    return dict(variables=[variable(name, name, value)
                           for name, value in values[:LIMIT]], length=len(values))


def refresh(*args, **kwargs):
    for comm in list(comms.values()):
        comm.send(dict(method='refresh', params=roots()))


def opened(comm, message):
    comms[comm.comm_id] = comm

    @comm.on_close
    def closed(message):
        comms.pop(comm.comm_id, None)

    @comm.on_msg
    def request(message):
        data = message['content']['data']
        try:
            if data['method'] == 'list':
                result = roots()
            elif data['method'] == 'inspect':
                path = data['params']['path']
                if not path or len(path) > 32:
                    raise ValueError('Invalid variable path')
                value = ip.user_ns[path[0]]
                for token in path[1:]:
                    value = next(item for key, name, item in children(value) if key == token)
                result = dict(children=[variable(key, label(name), item)
                                        for key, name, item in children(value)],
                              length=len(value) if type(value) in (list, tuple, dict) else 0)
            else:
                raise ValueError('Unsupported variables request')
            comm.send(dict(jsonrpc='2.0', id=data['id'], result=result))
        except Exception:
            comm.send(dict(jsonrpc='2.0', id=data.get('id'),
                           error=dict(code=-32602, message='Variable is no longer available')))

    comm.send(dict(method='refresh', params=roots()))


ip.kernel.comm_manager.register_target('openide.variables', opened)
ip.events.register('post_run_cell', refresh)
