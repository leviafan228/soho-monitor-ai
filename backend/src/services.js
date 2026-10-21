const AdapterFactory = require('./adapters');
const { Telemetry, EventLog } = require('./models');

class AnalyzerService {
  static async analyzeOutage(router, t_down, t_up) {
    const downtimeSeconds = Math.floor((t_up - t_down) / 1000);
    const bootTimeMargin = 60; // 60 секунд на завантаження

    try {
      const adapter = AdapterFactory.create(router.type, router.ip, router.credentials);
      const telemetry = await adapter.getTelemetry();
      
      let message, type;
      if ((telemetry.uptime + bootTimeMargin) < downtimeSeconds) {
        type = 'CRITICAL';
        message = "Зафіксовано втрату електроживлення (Power Outage)";
      } else {
        type = 'WARNING';
        message = "Аварія інтернет-провайдера (ISP Outage)";
      }

      await EventLog.create({
        routerId: router._id,
        type,
        message,
        downtimeSeconds
      });

      return message;
    } catch (error) {
      console.error('Помилка аналізу:', error);
    }
  }
}

module.exports = { AnalyzerService };